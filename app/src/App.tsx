/**
 * One URL, four states, and which one you get is decided by your session
 * and your membership — never by a route you have to find.
 *
 *   no session            -> the read-only pitch (anon RPC)
 *   session, not a member -> the join flow
 *   session, a member     -> the trip
 *   joining               -> the join flow, mid-stage
 *
 * The membership read comes FIRST when a session exists, and that ordering
 * is a correctness requirement, not a preference (spec §5.5): a member
 * whose invite link was later revoked is still a member, and routing them
 * through the preview RPC would answer "invite is invalid" and lock them
 * out of their own trip.
 */
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { WEB_JOIN_ENABLED } from './lib/config';
import { onSession, loadMe, type Me } from './lib/session';
import { inviteIdFromPath, loadPreview, type PreviewResult } from './lib/preview';
import { SharePreviewScreen } from './screens/SharePreview';
import { JoinScreen } from './screens/Join';
import { TripViewScreen } from './screens/TripView';
import { Banner } from './components/ui';

export function App() {
  const inviteId = inviteIdFromPath(location.pathname);
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [me, setMe] = useState<Me | null>(null);
  const [tripId, setTripId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [wantsJoin, setWantsJoin] = useState(location.hash === '#join');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => onSession(setSession), []);

  // Resolve identity and membership whenever the session changes.
  useEffect(() => {
    if (session === undefined) return;
    let live = true;
    if (!session) { setMe(null); setTripId(null); return; }
    loadMe()
      .then((m) => { if (live) setMe(m); })
      .catch((e) => { if (live) setError(e?.message ?? 'Could not load your account.'); });
    return () => { live = false; };
  }, [session]);

  // The preview doubles as the membership check: already_member is computed
  // by is_trip_member() server-side for the calling session.
  useEffect(() => {
    if (session === undefined) return;
    let live = true;
    loadPreview(inviteId).then((r) => {
      if (!live) return;
      setPreview(r);
      if (r.kind === 'found' && r.preview.already_member) setTripId(r.preview.trip_id);
    });
    return () => { live = false; };
  }, [session, inviteId]);

  const shell = (children: React.ReactNode) => (
    <>
      <header><a className="wordmark" href="/">advntr<span>.</span></a></header>
      <main><div className="wrap">{error && <Banner tone="error">{error}</Banner>}{children}</div></main>
      <footer><a href="/privacy.html">Privacy</a></footer>
    </>
  );

  if (session === undefined) return shell(<p className="state">Loading&hellip;</p>);

  if (me && tripId) return shell(<TripViewScreen tripId={tripId} me={me} inviteId={inviteId} />);

  if (WEB_JOIN_ENABLED && (wantsJoin || (me && !tripId && preview?.kind === 'found'))) {
    return shell(
      <JoinScreen
        inviteId={inviteId}
        me={me}
        tripName={preview?.kind === 'found' ? preview.preview.trip_name : 'this trip'}
        onJoined={() => {
          if (preview?.kind === 'found') setTripId(preview.preview.trip_id);
          history.replaceState(null, '', `/i/${inviteId}`);
        }}
        onCancel={() => { setWantsJoin(false); history.replaceState(null, '', `/i/${inviteId}`); }}
      />,
    );
  }

  return shell(<SharePreviewScreen inviteId={inviteId} onJoin={() => setWantsJoin(true)} preloaded={preview} />);
}
