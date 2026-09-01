/**
 * Same sink and same event names as invite.html, so the funnel keeps its
 * continuity across the cutover (spec §5.1). analytics_events has an
 * anon-insert policy built for exactly this page (adventure
 * 20260810000000_analytics_events.sql): the visitor has no session yet.
 * Best-effort — no await, no retry. A store/open-app tap fires right before
 * navigation and can lose the race, same as any fire-before-unload beacon.
 *
 * Payload additions over invite.html: `surface` says which page wrote the
 * row (old rows have none), `previewSource` says whether the proposals came
 * from get_trip_share_preview or the legacy four-field fallback.
 */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config';

export type EventName =
  | 'invite_opened'
  | 'invite_invalid'
  | 'invite_load_failed'
  | 'invite_store_tapped'
  | 'invite_open_app_tapped'
  | 'web_join_tapped';

export function track(name: EventName, inviteId: string, extra: Record<string, unknown> = {}): void {
  const payload = {
    inviteId,
    page: 'invite',
    surface: 'web-trip',
    ref: document.referrer || '',
    ...extra,
  };
  fetch(`${SUPABASE_URL}/rest/v1/analytics_events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ kind: name, payload }),
  }).catch(() => {});
}
