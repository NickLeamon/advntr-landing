/**
 * The join: sign in, confirm who you are, land in the trip.
 *
 * Three stages, and the order is the design (spec §5.4):
 *   auth    — the app door ABOVE the Google door, because an existing
 *             Apple-signed-in user who signs in with Google here becomes a
 *             SECOND person on the trip with a second vote, and Hide My
 *             Email means automatic identity linking cannot catch it.
 *             Routing them back is cheaper and surer than any plumbing.
 *   claim   — only when the link was generated for a named placeholder.
 *             "Joining as Sarah?" is asked, never assumed: a link
 *             forwarded twice would otherwise let the second person
 *             silently inherit the first's identity and every rating
 *             attributed to it.
 *   details — name and departure airport, submitted INSIDE the redeem
 *             transaction. FR60: an unresolved departure produces no fare
 *             and is counted as a declared gap, so skipping it quietly
 *             degrades the group's estimate for everyone.
 */
import { useEffect, useState } from 'react';
import { APP_SCHEME_JOIN, WEB_JOIN_ENABLED } from '../lib/config';
import { track } from '../lib/analytics';
import { DEV_TESTERS, devSignIn, loadClaimInfo, redeemInvite, signInWithGoogle, type Me } from '../lib/session';
import { searchDepartures } from '../lib/departureSearch';
import type { DepartureCity } from '../shared/departures';
import { Banner } from '../components/ui';

type Stage = 'auth' | 'claim' | 'details' | 'working';

export function JoinScreen({ inviteId, me, tripName, onJoined, onCancel }: {
  inviteId: string;
  me: Me | null;
  tripName: string;
  onJoined: () => void;
  onCancel: () => void;
}) {
  const [stage, setStage] = useState<Stage>(me ? 'claim' : 'auth');
  const [error, setError] = useState<string | null>(null);
  const [targetName, setTargetName] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(true);

  useEffect(() => {
    if (!me || stage !== 'claim') return;
    let live = true;
    loadClaimInfo(inviteId)
      .then((info) => {
        if (!live) return;
        setTargetName(info.targetName);
        // No placeholder to claim: nothing to confirm, go straight to details.
        if (!info.targetName) setStage('details');
      })
      .catch((e) => live && setError(e.message ?? 'Could not read this invite.'));
    return () => { live = false; };
  }, [me, stage, inviteId]);

  if (!WEB_JOIN_ENABLED) return null;

  return (
    <div className="join">
      {error && <Banner tone="error">{error}</Banner>}
      {stage === 'auth' && <AuthStage inviteId={inviteId} tripName={tripName} onError={setError} onCancel={onCancel} />}
      {stage === 'claim' && targetName && (
        <ClaimStage
          targetName={targetName}
          onAnswer={(yes) => { setClaiming(yes); setStage('details'); }}
        />
      )}
      {stage === 'claim' && !targetName && <p className="state">Checking the invite&hellip;</p>}
      {stage === 'details' && me && (
        <DetailsStage
          me={me}
          claimingName={claiming ? targetName : null}
          onSubmit={async (name, departureCityId) => {
            setStage('working');
            setError(null);
            try {
              await redeemInvite({ inviteId, claimPlaceholder: claiming, name, departureCityId });
              onJoined();
            } catch (e: any) {
              setError(e?.message ?? 'Could not join this trip.');
              setStage('details');
            }
          }}
        />
      )}
      {stage === 'working' && <p className="state">Joining&hellip;</p>}
    </div>
  );
}

function AuthStage({ inviteId, tripName, onError, onCancel }: {
  inviteId: string; tripName: string; onError: (e: string) => void; onCancel: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <p className="pitch">Add your vote on <span className="trip">{tripName}</span></p>
      <p className="meta">You’ll be able to rate every option, answer on the dates, and argue for your favourite.</p>

      {/* Above the Google button on purpose — see the header comment. */}
      <button
        className="cta secondary"
        onClick={() => { track('invite_open_app_tapped', inviteId, { from: 'join' }); location.href = APP_SCHEME_JOIN(inviteId); }}
      >
        Already using advntr? Open it in the app
      </button>
      <p className="fallback">
        That keeps you as one person on this trip. Signing in below with a different
        account would add you a second time.
      </p>

      <button
        className="cta"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const { error } = await signInWithGoogle(location.origin + `/i/${inviteId}`);
          if (error) { onError(error); setBusy(false); }
        }}
      >
        {busy ? 'Opening Google…' : 'Continue with Google'}
      </button>

      {import.meta.env.DEV && (
        <p className="fallback">
          dev:{' '}
          {DEV_TESTERS.map((n) => (
            <button
              key={n}
              className="linkish"
              onClick={async () => {
                const { error } = await devSignIn(n);
                if (error) onError(error);
              }}
            >
              {n}
            </button>
          ))}
        </p>
      )}

      <button className="linkish block-link" onClick={onCancel}>Not now, just show me the trip</button>
    </>
  );
}

function ClaimStage({ targetName, onAnswer }: { targetName: string; onAnswer: (yes: boolean) => void }) {
  return (
    <>
      <p className="pitch">Joining as <span className="trip">{targetName}</span>?</p>
      <p className="meta">
        Whoever sent this link saved a spot for {targetName}. If that’s you, we’ll move
        that spot — and anything already attributed to it — onto your account.
      </p>
      <button className="cta" onClick={() => onAnswer(true)}>Yes, that’s me</button>
      <button className="cta secondary" onClick={() => onAnswer(false)}>I’m someone else</button>
    </>
  );
}

function DetailsStage({ me, claimingName, onSubmit }: {
  me: Me;
  claimingName: string | null;
  onSubmit: (name: string, departureCityId: string) => void;
}) {
  const [name, setName] = useState(claimingName ?? me.name ?? '');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DepartureCity[]>([]);
  const [picked, setPicked] = useState<DepartureCity | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (picked || query.trim().length < 2) { setResults([]); return; }
    let live = true;
    setSearching(true);
    const t = setTimeout(() => {
      searchDepartures(query)
        .then((r) => { if (live) { setResults(r); setSearching(false); } })
        .catch(() => { if (live) { setResults([]); setSearching(false); } });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [query, picked]);

  const departureId = picked?.id ?? me.departureCityId;
  const ready = name.trim().length > 0 && !!departureId;

  return (
    <>
      <p className="pitch">Almost in</p>
      <p className="meta">The group sees your name on every rating you leave.</p>

      <label className="field">
        <span>Your name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sam" autoComplete="name" />
      </label>

      <label className="field">
        <span>Where you’d fly from</span>
        {picked || me.departureCityId ? (
          <div className="picked">
            <span>{picked ? `${picked.label}${picked.airport ? ` · ${picked.airport}` : ''}` : me.departureCityId}</span>
            <button className="linkish" onClick={() => { setPicked(null); setQuery(''); }}>Change</button>
          </div>
        ) : (
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Start typing a city" autoComplete="off" />
        )}
      </label>
      {!picked && !me.departureCityId && (
        <>
          {searching && <p className="fallback">Searching…</p>}
          {results.length > 0 && (
            <ul className="options">
              {results.map((r) => (
                <li key={r.id}>
                  <button onClick={() => { setPicked(r); setResults([]); }}>
                    {r.label}{r.airport ? <span className="iata"> {r.airport}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      <p className="fallback">
        Flights are personal — everyone flies from their own city. Without yours,
        the group’s estimate is short by one seat and says so.
      </p>

      <button className="cta" disabled={!ready} onClick={() => onSubmit(name.trim(), departureId)}>
        Join the trip
      </button>
    </>
  );
}
