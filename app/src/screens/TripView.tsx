/**
 * The member surface. What a web participant can do, and nothing else.
 *
 * FR61 is the whole design rule: authorization mirrors the app exactly,
 * minus anything that depends on Discover. So rating, dates, the thread,
 * availability, the booking sheet, locking and reopening are all here —
 * because the app grants those to any member — and proposing is not,
 * because proposing is the swipe loop.
 *
 * Deliberately absent: the price estimate. Computing one means vendoring
 * price.ts, flights.ts, fares.ts and the departures/geo helpers, and FR62
 * forbids the two surfaces quoting different totals. Not duplicating the
 * model at all is the strongest guarantee of that, so this page says the
 * numbers are in the app rather than showing a second, drifting figure.
 * Flagged in DESIGN-NOTES as a deviation, not slipped in.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { APP_SCHEME_JOIN, STORE_URL } from '../lib/config';
import { signOut, type Me } from '../lib/session';
import { formatRangeFrom, relativeTime } from '../lib/format';
import {
  claimTask, decideTrip, leaveTrip, likeComment, loadTrip, postComment, proposalScore,
  rankProposal, reportComment, respondToDates, setAvailability, setTaskBooked, subscribeTrip,
  unclaimTask, type Proposal, type TripView as Trip,
} from '../lib/trip';
import { Avatar, Banner, Section, StarRow } from '../components/ui';

export function TripViewScreen({ tripId, me, inviteId }: { tripId: string; me: Me; inviteId: string }) {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setTrip(await loadTrip(tripId));
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load this trip.');
    } finally {
      setLoaded(true);
    }
  }, [tripId]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => subscribeTrip(refresh), [refresh]);

  // Any write refreshes from the server rather than patching local state —
  // the same "refetch, never drift" model backend.ts uses, and the reason
  // a failed write cannot leave the page showing something that did not
  // happen.
  const run = async (fn: () => Promise<void>) => {
    try { await fn(); setError(null); } catch (e: any) { setError(e?.message ?? 'That didn’t go through.'); }
    await refresh();
  };

  if (!loaded) return <p className="state">Loading the trip&hellip;</p>;
  if (!trip) {
    return (
      <p className="state">
        You’re not on this trip.<br /><br />
        <a href="/">Learn about advntr &rarr;</a>
      </p>
    );
  }

  const you = trip.members.find((m) => m.id === me.travelerId);
  const decided = trip.proposals.find((p) => p.isDecided) ?? null;
  const others = [...trip.proposals]
    .filter((p) => !p.isDecided)
    .sort((a, b) => (proposalScore(b).score ?? -1) - (proposalScore(a).score ?? -1));
  const leaderId = !decided && others.length > 1 && proposalScore(others[0]).score != null ? others[0].id : null;
  const joined = trip.members.filter((m) => m.onApp);

  return (
    <>
      {error && <Banner tone="error">{error}</Banner>}
      {trip.coverPhotoUrl && <img className="cover" src={trip.coverPhotoUrl} alt="" />}
      <p className="pitch">{trip.name}</p>
      <p className="meta">
        {joined.length} {joined.length === 1 ? 'person' : 'people'} in
        {trip.decideDeadlineAt && !decided && <> · auto-decides {new Date(trip.decideDeadlineAt).toLocaleDateString()}</>}
      </p>

      {decided && (
        <Section
          title="The pick"
          action={
            <button className="linkish" onClick={() => {
              if (confirm('Reopen this trip? Everyone can rate and change their votes again. The booking sheet stays as it is.')) {
                run(() => decideTrip(trip.id, null));
              }
            }}>Reopen</button>
          }
        >
          <ProposalCard p={decided} trip={trip} me={me} badge="The pick" accent run={run} />
          <BookingSheet trip={trip} decided={decided} me={me} run={run} />
        </Section>
      )}

      <Section title={decided ? 'Also considered' : others.length === 1 ? '1 proposal' : `${others.length} proposals`}>
        {others.length === 0 ? (
          <p className="empty">
            Nothing pitched yet. Proposals come from the app — the swipe feed is where
            a trip gets built.
          </p>
        ) : (
          <div className="cards">
            {others.map((p) => (
              <ProposalCard
                key={p.id}
                p={p}
                trip={trip}
                me={me}
                badge={p.id === leaderId ? 'Leading' : null}
                run={run}
                onDecide={!decided ? () => {
                  if (confirm(`Lock in ${p.cityName}? Everyone stops rating and the group moves to booking. Any member can reopen it.`)) {
                    run(() => decideTrip(trip.id, p.id));
                  }
                } : undefined}
              />
            ))}
          </div>
        )}
      </Section>

      <Section title="Who’s in">
        <ul className="people">
          {trip.members.map((m) => (
            <li key={m.id}>
              <Avatar name={m.name} emoji={m.emoji} avatarUrl={m.avatarUrl} />
              <span className="who">
                {m.id === me.travelerId ? 'You' : m.name}
                {!m.onApp && <span className="tag">invited</span>}
              </span>
              {m.availability && <span className="note">{m.availability}</span>}
            </li>
          ))}
        </ul>
        {you && <AvailabilityField trip={trip} you={you.availability} me={me} run={run} />}
      </Section>

      <Chat trip={trip} me={me} run={run} />

      <Section title="Proposing">
        <p className="empty">
          Pitching a place is the app: you swipe a feed of real activities and it builds
          the proposal — with flights, a stay and a real price — around what you liked.
          That doesn’t work in a browser.
        </p>
        <div className="doors">
          <a className="cta" href={STORE_URL}>Get advntr to propose a place</a>
          <a className="cta secondary" href={APP_SCHEME_JOIN(inviteId)}>Open in advntr</a>
        </div>
      </Section>

      <p className="fallback">
        Prices, flight estimates and the map live in the app — one place, so the two
        never disagree.{' '}
        <button className="linkish" onClick={() => {
          if (you && confirm('Leave this trip? Your ratings and messages stay with the group.')) {
            run(() => leaveTrip(trip.id, me.travelerId)).then(() => { location.href = '/'; });
          }
        }}>Leave trip</button>
        {' · '}
        <button className="linkish" onClick={() => signOut()}>Sign out</button>
      </p>
    </>
  );
}

function ProposalCard({ p, trip, me, badge, accent, run, onDecide }: {
  p: Proposal; trip: Trip; me: Me; badge: string | null; accent?: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  onDecide?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const talkCount = trip.chat.filter((c) => c.draftId === p.id).length;
  const { score, votes } = proposalScore(p);
  const yourRank = p.rankings[me.travelerId] ?? null;
  const yourDate = p.dateResponses[me.travelerId] ?? null;
  const conflicts = Object.values(p.dateResponses).filter((r) => r === 'conflict').length;
  const bits = [
    `${p.days} ${p.days === 1 ? 'day' : 'days'}`,
    p.activityCount > 0 ? `${p.activityCount} ${p.activityCount === 1 ? 'thing' : 'things'} to do` : null,
    p.lodgingName ? 'stay picked' : null,
  ].filter(Boolean);

  return (
    <div className={`card col${p.isDecided ? ' decided' : ''}`}>
      <div className="card-top">
        {p.image ? <img className="card-img" src={p.image} alt="" /> : <div className="card-img empty">✈</div>}
        <div className="card-body">
          <p className="card-title">{p.cityName}{p.region ? `, ${p.region}` : ''}</p>
          <p className="card-sub">{bits.join(' · ')}</p>
          {p.startDate && <p className="card-sub">{formatRangeFrom(p.startDate, p.days)}</p>}
          <p className="card-rating">
            {score != null ? <><span>★ {score.toFixed(1)}</span><span className="votes">{votes} {votes === 1 ? 'vote' : 'votes'}</span></>
              : <span className="votes">No votes yet</span>}
            {badge && <span className={`badge${accent ? ' accent' : ''}`}>{badge}</span>}
          </p>
        </div>
      </div>

      <div className="vote">
        <span className="vote-label">Your rating</span>
        <StarRow value={yourRank} onPick={(n) => run(() => rankProposal(p.id, me.travelerId, n))} />
      </div>

      {p.startDate && (
        <div className="vote">
          <span className="vote-label">
            {formatRangeFrom(p.startDate, p.days)}
            {conflicts > 0 && <span className="note"> {conflicts} can’t make it</span>}
          </span>
          <span className="choices">
            <button
              className={`choice${yourDate === 'works' ? ' on' : ''}`}
              onClick={() => run(() => respondToDates(p.id, me.travelerId, 'works'))}
            >Works for me</button>
            <button
              className={`choice${yourDate === 'conflict' ? ' on' : ''}`}
              onClick={() => run(() => respondToDates(p.id, me.travelerId, 'conflict'))}
            >Conflict</button>
          </span>
        </div>
      )}

      {/* ONE disclosure per card, not three stacked affordances. It opens
          what's in the proposal and its own thread together, because
          "what's in it" and "what people said about it" are the same
          question asked twice. Three message boxes on one page — two per
          card plus the trip thread — read as clutter on a screen someone
          opens twice a year. */}
      <div className="card-foot">
        <button className="linkish" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide details' : `Details${talkCount > 0 ? ` · ${talkCount}` : ''}`}
        </button>
        {onDecide && <button className="choice decide" onClick={onDecide}>Lock this one in</button>}
      </div>
      {open && (
        <>
          <ul className="items">
            {p.lodgingName && <li><span className="kind">Stay</span>{p.lodgingName}</li>}
            {p.activityTitles.map((t, i) => <li key={i}><span className="kind">Do</span>{t}</li>)}
            {p.externals.map((e) => (
              <li key={e.id}>
                <span className="kind">{e.kind === 'stay' ? 'Stay' : 'Do'}</span>
                {e.url ? <a href={e.url} target="_blank" rel="noreferrer">{e.title}</a> : e.title}
                {e.note && <span className="note"> {e.note}</span>}
              </li>
            ))}
            {p.activityTitles.length === 0 && p.externals.length === 0 && !p.lodgingName && (
              <li className="note">Nothing added to this one yet.</li>
            )}
          </ul>
          <TalkAbout trip={trip} draftId={p.id} me={me} run={run} />
        </>
      )}
    </div>
  );
}

function TalkAbout({ trip, draftId, me, run }: {
  trip: Trip; draftId: string; me: Me; run: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const mine = trip.chat.filter((c) => c.draftId === draftId);
  const nameOf = (id: string) => (id === me.travelerId ? 'You' : trip.members.find((m) => m.id === id)?.name ?? 'Someone');
  return (
    <div className="talk">
      {mine.length === 0 && <p className="talk-line note">Nobody’s argued for this one yet.</p>}
      {mine.map((c) => (
        <p key={c.id} className="talk-line"><b>{nameOf(c.travelerId)}</b> {c.text}</p>
      ))}
      <form
        className="composer small"
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t) return;
          setText('');
          run(() => postComment({ tripId: trip.id, travelerId: me.travelerId, text: t, draftId }));
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Say something about this one" />
        <button type="submit" disabled={!text.trim()}>Send</button>
      </form>
    </div>
  );
}

function AvailabilityField({ trip, you, me, run }: {
  trip: Trip; you: string; me: Me; run: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [note, setNote] = useState(you);
  const dirty = note.trim() !== you.trim();
  return (
    <form
      className="composer"
      onSubmit={(e) => { e.preventDefault(); run(() => setAvailability(trip.id, me.travelerId, note.trim())); }}
    >
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="When you're free — “out before Jun 15”" />
      <button type="submit" disabled={!dirty}>Save</button>
    </form>
  );
}

function BookingSheet({ trip, decided, me, run }: {
  trip: Trip; decided: Proposal; me: Me; run: (fn: () => Promise<void>) => Promise<void>;
}) {
  // taskKey grammar is the app's: 'lodging' | 'activity:<id>' | 'external:<id>'.
  // Keyed on the catalog activity id, NOT its position: TripHomeScreen
  // builds `activity:${aid}` from the same ids, and a positional key would
  // create claim rows the app cannot match to any duty — two surfaces
  // silently disagreeing about who booked what.
  const tasks: { key: string; label: string }[] = [
    ...(decided.lodgingName ? [{ key: 'lodging', label: decided.lodgingName }] : []),
    ...decided.activityIds.map((id, i) => ({ key: `activity:${id}`, label: decided.activityTitles[i] ?? id })),
    ...decided.externals.map((e) => ({ key: `external:${e.id}`, label: e.title })),
  ];
  if (tasks.length === 0) return null;
  const nameOf = (id: string) => (id === me.travelerId ? 'You' : trip.members.find((m) => m.id === id)?.name ?? 'Someone');
  return (
    <>
      <h3 className="section-title sub">Who books what</h3>
      <ul className="tasks">
        {tasks.map((t) => {
          const claim = trip.claims[t.key];
          const yours = claim?.travelerId === me.travelerId;
          return (
            <li key={t.key}>
              <span className="task-label">{t.label}</span>
              {!claim && <button className="linkish" onClick={() => run(() => claimTask(trip.id, t.key, me.travelerId))}>I’ve got this</button>}
              {claim && !yours && <span className="note">{nameOf(claim.travelerId)}{claim.bookedAt ? ' · booked' : ''}</span>}
              {claim && yours && (
                <span className="choices">
                  <button
                    className={`choice${claim.bookedAt ? ' on' : ''}`}
                    onClick={() => run(() => setTaskBooked(trip.id, t.key, !claim.bookedAt))}
                  >{claim.bookedAt ? 'Booked' : 'Mark booked'}</button>
                  <button className="linkish" onClick={() => run(() => unclaimTask(trip.id, t.key))}>Drop</button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="fallback">
        Booking happens on the hotel’s or operator’s own site — advntr can’t see it, so
        “booked” is something you tell the group, never something we infer.
      </p>
    </>
  );
}

function Chat({ trip, me, run }: {
  trip: Trip; me: Me; run: (fn: () => Promise<void>) => Promise<void>;
}) {
  const [text, setText] = useState('');
  const general = useMemo(() => trip.chat.filter((c) => !c.draftId), [trip.chat]);
  const nameOf = (id: string) => (id === me.travelerId ? 'You' : trip.members.find((m) => m.id === id)?.name ?? 'Someone');
  return (
    <Section title="The thread">
      {general.length === 0 ? (
        <p className="empty">Nobody’s said anything yet.</p>
      ) : (
        <ul className="chat">
          {general.map((c) => {
            const liked = c.likes.includes(me.travelerId);
            return (
              <li key={c.id}>
                <Avatar
                  name={nameOf(c.travelerId)}
                  emoji={trip.members.find((m) => m.id === c.travelerId)?.emoji}
                  avatarUrl={trip.members.find((m) => m.id === c.travelerId)?.avatarUrl}
                  size={24}
                />
                <div>
                  <p className="chat-meta"><b>{nameOf(c.travelerId)}</b> <span className="note">{relativeTime(c.at)}</span></p>
                  <p className="chat-body">{c.text}</p>
                  <p className="chat-actions">
                    <button className={`linkish${liked ? ' on' : ''}`} onClick={() => run(() => likeComment(c.id, me.travelerId, !liked))}>
                      ♥ {c.likes.length || ''}
                    </button>
                    {c.travelerId !== me.travelerId && (
                      <button className="linkish" onClick={() => {
                        if (confirm('Report this message? It gets hidden for you and sent for review.')) {
                          run(() => reportComment(trip.id, c.id, me.travelerId, 'inappropriate'));
                        }
                      }}>Report</button>
                    )}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (!t) return;
          setText('');
          run(() => postComment({ tripId: trip.id, travelerId: me.travelerId, text: t }));
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Say something to the group" />
        <button type="submit" disabled={!text.trim()}>Send</button>
      </form>
    </Section>
  );
}
