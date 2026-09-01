/**
 * The signed-out read. Two RPCs, one shape.
 *
 * get_trip_share_preview (adventure 20260901120000) returns the FR57
 * "shown" set — trip, counts, one card per proposal. It is anon-callable
 * and it may not be deployed yet to the project this page is pointed at:
 * migrations land through the adventure repo's DB Deploy workflow, on a
 * different cadence from a Vercel deploy of this site. So a missing
 * function (PostgREST PGRST202) falls back to get_invite_preview, the
 * four-field RPC invite.html has always used, and the page renders the
 * trimmed card it always rendered. Nothing is dead on either side of the
 * DB deploy.
 */
import { supabase } from './supabase';

export interface ProposalCard {
  id: string;
  city_id: string;
  city_name: string | null;
  country: string | null;
  state: string | null;
  hero_image_url: string | null;
  hero_gallery: { url: string }[];
  days: number;
  activity_count: number;
  has_stay: boolean;
  rating_count: number;
  rating_avg: number | null;
  is_decided: boolean;
}

export interface SharePreview {
  trip_id: string;
  trip_name: string;
  cover_photo_url: string | null;
  inviter_first_name: string | null;
  member_count: number;
  decided_draft_id: string | null;
  already_member: boolean;
  proposals: ProposalCard[];
  /** Which RPC answered — carried into analytics, never shown. */
  source: 'share' | 'legacy';
  /** Legacy fallback only: the count get_invite_preview reports. */
  draft_count?: number;
}

export type PreviewResult =
  | { kind: 'found'; preview: SharePreview }
  | { kind: 'invalid'; reason: 'no_id' | 'not_found' }
  | { kind: 'failed' };

const FUNCTION_MISSING = 'PGRST202';

export async function loadPreview(inviteId: string): Promise<PreviewResult> {
  if (!inviteId) return { kind: 'invalid', reason: 'no_id' };

  const share = await supabase.rpc('get_trip_share_preview', { p_invite_id: inviteId });
  if (!share.error) {
    if (share.data == null) return { kind: 'invalid', reason: 'not_found' };
    const d = share.data as Omit<SharePreview, 'source'>;
    return { kind: 'found', preview: { ...d, proposals: d.proposals ?? [], source: 'share' } };
  }
  if (share.error.code !== FUNCTION_MISSING) return { kind: 'failed' };

  const legacy = await supabase.rpc('get_invite_preview', { p_invite_id: inviteId });
  if (legacy.error) return { kind: 'failed' };
  const row = (legacy.data as any[] | null)?.[0];
  if (!row) return { kind: 'invalid', reason: 'not_found' };
  return {
    kind: 'found',
    preview: {
      trip_id: row.trip_id,
      trip_name: row.trip_name,
      cover_photo_url: null,
      inviter_first_name: row.inviter_first_name ?? null,
      member_count: row.member_count ?? 0,
      decided_draft_id: null,
      already_member: !!row.already_member,
      proposals: [],
      draft_count: row.draft_count ?? 0,
      source: 'legacy',
    },
  };
}

/** `/i/<id>` or `/join/<id>`, same parse invite.html used. */
export function inviteIdFromPath(pathname: string): string {
  return decodeURIComponent(pathname.replace(/^\/(?:i|join)\//, '').replace(/\/$/, ''));
}
