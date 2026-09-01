/**
 * The signed-out page: what a stranger with the link sees (spec §5.2).
 *
 * Grammar carried over from invite.html on purpose — "<inviter> wants your
 * take on <trip>", the two explicit doors, the TestFlight note — because
 * that page's copy has been through real recipients, and because the two
 * doors being explicit (no racing timer) is a lesson paid for. What's new
 * is the middle: the proposals, so the page can make its case.
 */
import { useEffect, useState } from 'react';
import { APP_SCHEME_JOIN, STORE_URL, WEB_JOIN_ENABLED } from '../lib/config';
import { track } from '../lib/analytics';
import { loadPreview, type PreviewResult, type ProposalCard, type SharePreview as Preview } from '../lib/preview';
import { photographicHero } from '../shared/hero';

// Same sort TripHomeScreen applies: score desc, unscored last.
const score = (p: ProposalCard) => (p.rating_count > 0 && p.rating_avg != null ? p.rating_avg : -1);

export function SharePreviewScreen({ inviteId, onJoin, preloaded }: {
  inviteId: string;
  onJoin?: () => void;
  /** App resolves the preview once (it doubles as the membership check);
   *  reuse it rather than paying a second round trip on first paint. */
  preloaded?: PreviewResult | null;
}) {
  const [result, setResult] = useState<PreviewResult | null>(preloaded ?? null);

  useEffect(() => {
    if (preloaded) { setResult(preloaded); return; }
    let live = true;
    loadPreview(inviteId).then((r) => {
      if (!live) return;
      setResult(r);
    });
    return () => { live = false; };
  }, [inviteId, preloaded]);

  // Fires once per resolved outcome, whoever loaded it.
  const [tracked, setTracked] = useState(false);
  useEffect(() => {
    if (!result || tracked) return;
    setTracked(true);
    if (result.kind === 'found') track('invite_opened', inviteId, { previewSource: result.preview.source, proposals: result.preview.proposals.length });
    else if (result.kind === 'invalid') track('invite_invalid', inviteId, { reason: result.reason });
    else track('invite_load_failed', inviteId);
  }, [result, tracked, inviteId]);

  if (!result) return <p className="state">Loading the trip&hellip;</p>;
  if (result.kind === 'invalid') {
    return (
      <p className="state">
        This link isn’t valid anymore. It may have expired or been revoked.<br /><br />
        <a href="/">Learn about advntr &rarr;</a>
      </p>
    );
  }
  if (result.kind === 'failed') {
    return <p className="state">Couldn’t load this trip. Check your connection and reload.</p>;
  }
  return <Found inviteId={inviteId} preview={result.preview} onJoin={onJoin} />;
}

function Found({ inviteId, preview, onJoin }: { inviteId: string; preview: Preview; onJoin?: () => void }) {
  const inviter = preview.inviter_first_name || 'A friend';
  const proposals = [...preview.proposals].sort((a, b) => score(b) - score(a));
  const decided = proposals.find((p) => p.is_decided) ?? null;
  const others = decided ? proposals.filter((p) => p.id !== decided.id) : proposals;
  const placeCount = preview.source === 'legacy' ? (preview.draft_count ?? 0) : proposals.length;
  const placeWord = placeCount === 1 ? 'place' : 'places';
  // TripHomeScreen's "leader" rule: first by score, only when there's a
  // contest, only when someone has actually voted.
  const leaderId = !decided && others.length > 1 && score(others[0]) >= 0 ? others[0].id : null;

  // Must run inside the click handler — clipboard writes only resolve inside
  // a user gesture on iOS Safari. The app reads the id back off the
  // clipboard when it opens without a deep link.
  const copyId = () => navigator.clipboard?.writeText(inviteId).catch(() => {});
  const openStore = () => { copyId(); track('invite_store_tapped', inviteId); location.href = STORE_URL; };
  const openApp = () => { copyId(); track('invite_open_app_tapped', inviteId); location.href = APP_SCHEME_JOIN(inviteId); };

  return (
    <>
      {preview.cover_photo_url && <img className="cover" src={preview.cover_photo_url} alt="" />}
      <p className="pitch">
        {inviter} wants your take on <span className="trip">{preview.trip_name}</span>
      </p>
      {/* The cards below say how many places there are; only the legacy
          four-field fallback needs the count spelled out. */}
      <p className="meta">
        {preview.source === 'legacy' && <>{placeCount} {placeWord} pitched</>}
        {preview.source === 'legacy' && preview.member_count > 0 && <> · </>}
        {preview.member_count > 0 && <>{preview.member_count} already in</>}
      </p>

      {decided && (
        <>
          <p className="section-title">The pick</p>
          <div className="cards"><Card p={decided} badge="The pick" accent /></div>
        </>
      )}

      {preview.source === 'share' && (
        others.length === 0 ? (
          !decided && <p className="empty">No places pitched yet — be the first to weigh in once there are.</p>
        ) : (
          <>
            <p className="section-title">{decided ? 'Also considered' : `${others.length} proposals`}</p>
            <div className="cards">
              {others.map((p) => <Card key={p.id} p={p} badge={p.id === leaderId ? 'Leading' : null} />)}
            </div>
          </>
        )
      )}

      <div className="doors">
        {WEB_JOIN_ENABLED && onJoin && (
          <button className="cta" onClick={() => { track('web_join_tapped', inviteId); onJoin?.(); }}>
            Add your vote
          </button>
        )}
        <button className={WEB_JOIN_ENABLED ? 'cta secondary' : 'cta'} onClick={openStore}>
          Get advntr &amp; join
        </button>
        <button className="cta secondary" onClick={openApp}>I already have advntr</button>
      </div>
      <p className="fallback">
        Want to pitch a place of your own? That’s the app — free beta on TestFlight.
        Install it, come back here, and tap “I already have advntr”.
      </p>
    </>
  );
}

function Card({ p, badge, accent }: { p: ProposalCard; badge: string | null; accent?: boolean }) {
  const img = photographicHero(p);
  const where = p.city_name ?? p.city_id;
  const region = p.country === 'USA' && p.state ? p.state : p.country;
  const bits = [
    `${p.days} ${p.days === 1 ? 'day' : 'days'}`,
    p.activity_count > 0 ? `${p.activity_count} ${p.activity_count === 1 ? 'thing' : 'things'} to do` : null,
    p.has_stay ? 'stay picked' : null,
  ].filter(Boolean);
  return (
    <div className={`card${p.is_decided ? ' decided' : ''}`}>
      {img ? <img className="card-img" src={img} alt="" /> : <div className="card-img empty">✈</div>}
      <div className="card-body">
        <p className="card-title">{where}{region ? `, ${region}` : ''}</p>
        <p className="card-sub">{bits.join(' · ')}</p>
        <p className="card-rating">
          {p.rating_count > 0 && p.rating_avg != null
            ? <><span>★ {p.rating_avg.toFixed(1)}</span><span className="votes">{p.rating_count} {p.rating_count === 1 ? 'vote' : 'votes'}</span></>
            : <span className="votes">No votes yet</span>}
          {badge && <span className={`badge${accent ? ' accent' : ''}`}>{badge}</span>}
        </p>
      </div>
    </div>
  );
}
