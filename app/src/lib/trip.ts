/**
 * The member surface's data layer: one trip, read and written through
 * PostgREST under the member's own session.
 *
 * There is no new backend here and that is the point. A web member is a
 * member (FR59/FR61), so every read below is the same read backend.ts
 * makes and every write is the same write, gated by the same RLS. If a
 * policy says a member may do it, this can; if it doesn't, this gets a
 * permission error, same as the app would.
 *
 * Two differences from backend.ts, both deliberate:
 *   * Scoped to one trip. The app hydrates everything because it has a
 *     trips list; this page was reached by one link and shows one trip.
 *   * No price estimate. Computing one means vendoring price.ts,
 *     flights.ts, fares.ts and the departures/geo helpers — a large
 *     surface, and FR62 says the two surfaces may never quote different
 *     totals. Not duplicating the model at all is the strongest guarantee
 *     of that. The page says the numbers are in the app rather than
 *     showing a second, possibly-disagreeing figure.
 */
import { supabase } from './supabase';
import { photographicHero } from '../shared/hero';

export interface Member {
  id: string;
  name: string;
  emoji: string | null;
  avatarUrl: string | null;
  departureCityId: string;
  /** False = a placeholder someone added; they have no session and no votes. */
  onApp: boolean;
  availability: string;
}

export interface Proposal {
  id: string;
  cityId: string;
  cityName: string;
  region: string;
  image: string;
  days: number;
  startDate: string | null;
  /** Catalog activity ids, in the order the proposer added them. The
   *  booking sheet's task keys are built from these — `activity:<id>` —
   *  so a claim made on the web is the same row the app reads. */
  activityIds: string[];
  activityTitles: string[];
  activityCount: number;
  lodgingName: string | null;
  externals: { id: string; kind: 'stay' | 'activity'; title: string; url: string | null; note: string | null }[];
  /** travelerId -> 1..5 */
  rankings: Record<string, number>;
  dateResponses: Record<string, 'works' | 'conflict'>;
  createdBy: string;
  createdAt: number;
  isDecided: boolean;
}

export interface ChatMessage {
  id: string;
  travelerId: string;
  text: string;
  at: number;
  draftId: string | null;
  replyToId: string | null;
  needsDecision: boolean;
  likes: string[];
}

export interface TripView {
  id: string;
  name: string;
  coverPhotoUrl: string | null;
  budget: number | null;
  createdBy: string;
  decidedDraftId: string | null;
  decideDeadlineAt: number | null;
  members: Member[];
  proposals: Proposal[];
  chat: ChatMessage[];
  /** taskKey -> claim */
  claims: Record<string, { travelerId: string; bookedAt: number | null }>;
}

const ms = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);

/** Same rule as tripStore.draftScore: mean of the ranks, null with no votes. */
export function proposalScore(p: Proposal): { score: number | null; votes: number } {
  const values = Object.values(p.rankings);
  if (values.length === 0) return { score: null, votes: 0 };
  return { score: values.reduce((a, b) => a + b, 0) / values.length, votes: values.length };
}

export async function loadTrip(tripId: string): Promise<TripView | null> {
  const [trip, memberRows, draftRows] = await Promise.all([
    supabase.from('trips').select('*').eq('id', tripId).maybeSingle(),
    supabase.from('trip_members').select('*').eq('trip_id', tripId),
    supabase.from('drafts').select('*').eq('trip_id', tripId),
  ]);
  if (trip.error) throw trip.error;
  if (!trip.data) return null; // RLS says we are not a member of this trip
  if (memberRows.error) throw memberRows.error;
  if (draftRows.error) throw draftRows.error;

  const memberIds = (memberRows.data ?? []).map((m: any) => m.traveler_id);
  const draftIds = (draftRows.data ?? []).map((d: any) => d.id);
  const cityIds = [...new Set((draftRows.data ?? []).map((d: any) => d.city_id))];
  const lodgingIds = [...new Set((draftRows.data ?? []).map((d: any) => d.lodging_id).filter(Boolean))];
  const activityIds = [...new Set((draftRows.data ?? []).flatMap((d: any) => d.activity_ids ?? []))];

  const [travelers, rankings, responses, comments, claims, externals, cities, lodging, activities] =
    await Promise.all([
        // `*`, not a column list, and deliberately: prod and QA are deployed
      // on different cadences (adventure's db-deploy-prod is manual), so a
      // column that exists on one can be missing on the other. PostgREST
      // errors the whole request on an unknown column but returns whatever
      // exists for `*`. backend.ts reads these tables the same way for the
      // same reason. Found live: avatar_url and cover_photo_url are on QA
      // and not on prod, and an explicit list took the whole page down.
      supabase.from('travelers').select('*').in('id', memberIds.length ? memberIds : ['-']),
      supabase.from('draft_rankings').select('*').in('draft_id', draftIds.length ? draftIds : ['-']),
      supabase.from('draft_date_responses').select('*').in('draft_id', draftIds.length ? draftIds : ['-']),
      supabase.from('comments').select('*').eq('trip_id', tripId),
      supabase.from('claims').select('*').eq('trip_id', tripId),
      supabase.from('draft_externals').select('*').in('draft_id', draftIds.length ? draftIds : ['-']),
        supabase.from('catalog_destinations').select('*').in('id', cityIds.length ? cityIds : ['-']),
      lodgingIds.length
        ? supabase.from('catalog_lodging').select('id,name').in('id', lodgingIds)
        : Promise.resolve({ data: [], error: null } as any),
      activityIds.length
        ? supabase.from('catalog_activities').select('id,title').in('id', activityIds)
        : Promise.resolve({ data: [], error: null } as any),
    ]);

  const commentIds = (comments.data ?? []).map((c: any) => c.id);
  const likes = commentIds.length
    ? await supabase.from('comment_likes').select('*').in('comment_id', commentIds)
    : ({ data: [], error: null } as any);

  const cityById = new Map<string, any>((cities.data ?? []).map((c: any) => [c.id, c]));
  const lodgingById = new Map<string, string>((lodging.data ?? []).map((l: any) => [l.id, l.name]));
  // Composite-keyed (destination_id, id) since 20260823210000, so the same
  // product code can appear under two destinations. Titles are identical
  // across those copies, so a plain id lookup is safe here.
  const activityById = new Map<string, string>((activities.data ?? []).map((a: any) => [a.id, a.title]));
  const availabilityBy = new Map<string, string>((memberRows.data ?? []).map((m: any) => [m.traveler_id, m.availability ?? '']));

  const members: Member[] = (travelers.data ?? []).map((t: any) => ({
    id: t.id,
    name: t.name ?? '',
    emoji: t.emoji ?? null,
    avatarUrl: t.avatar_url ?? null,
    departureCityId: t.departure_city_id ?? '',
    onApp: t.user_id != null,
    availability: availabilityBy.get(t.id) ?? '',
  }));

  const rankingsByDraft: Record<string, Record<string, number>> = {};
  for (const r of rankings.data ?? []) {
    (rankingsByDraft[(r as any).draft_id] ??= {})[(r as any).traveler_id] = (r as any).rank;
  }
  const responsesByDraft: Record<string, Record<string, 'works' | 'conflict'>> = {};
  for (const r of responses.data ?? []) {
    (responsesByDraft[(r as any).draft_id] ??= {})[(r as any).traveler_id] = (r as any).response;
  }
  const externalsByDraft: Record<string, Proposal['externals']> = {};
  for (const e of externals.data ?? []) {
    (externalsByDraft[(e as any).draft_id] ??= []).push({
      id: (e as any).id, kind: (e as any).kind, title: (e as any).title,
      url: (e as any).url, note: (e as any).note,
    });
  }
  const likesByComment: Record<string, string[]> = {};
  for (const l of likes.data ?? []) {
    (likesByComment[(l as any).comment_id] ??= []).push((l as any).traveler_id);
  }

  const proposals: Proposal[] = (draftRows.data ?? []).map((d: any) => {
    const city: any = cityById.get(d.city_id);
    const externalActivities = (externalsByDraft[d.id] ?? []).filter((e) => e.kind === 'activity').length;
    return {
      id: d.id,
      cityId: d.city_id,
      cityName: city?.name ?? d.city_id,
      // Same rule as catalog.ts placeRegionLabel.
      region: city ? (city.country === 'USA' && city.state ? city.state : city.country ?? '') : '',
      image: city ? photographicHero({ hero_image_url: city.hero_image_url, hero_gallery: city.hero_gallery }) : '',
      days: d.days,
      startDate: d.start_date,
      activityIds: (d.activity_ids ?? []) as string[],
      activityTitles: (d.activity_ids ?? []).map((id: string) => activityById.get(id)).filter((t: string | undefined): t is string => !!t),
      activityCount: (d.activity_ids ?? []).length + externalActivities,
      lodgingName: d.lodging_id ? lodgingById.get(d.lodging_id) ?? null : null,
      externals: externalsByDraft[d.id] ?? [],
      rankings: rankingsByDraft[d.id] ?? {},
      dateResponses: responsesByDraft[d.id] ?? {},
      createdBy: d.created_by,
      createdAt: ms(d.created_at),
      isDecided: d.id === trip.data.decided_draft_id,
    };
  });

  const chat: ChatMessage[] = (comments.data ?? [])
    .map((c: any) => ({
      id: c.id, travelerId: c.traveler_id, text: c.body, at: ms(c.created_at),
      draftId: c.draft_id, replyToId: c.reply_to_id, needsDecision: c.needs_decision,
      likes: likesByComment[c.id] ?? [],
    }))
    .sort((a, b) => a.at - b.at);

  const claimMap: TripView['claims'] = {};
  for (const c of claims.data ?? []) {
    claimMap[(c as any).task_key] = {
      travelerId: (c as any).traveler_id,
      bookedAt: (c as any).booked_at ? ms((c as any).booked_at) : null,
    };
  }

  return {
    id: trip.data.id,
    name: trip.data.name,
    coverPhotoUrl: trip.data.cover_photo_url ?? null,
    budget: trip.data.budget ?? null,
    createdBy: trip.data.created_by,
    decidedDraftId: trip.data.decided_draft_id ?? null,
    decideDeadlineAt: trip.data.decide_deadline_at ? ms(trip.data.decide_deadline_at) : null,
    members,
    proposals,
    chat,
    claims: claimMap,
  };
}

// ——— writes ————————————————————————————————————————————————————————————————
// One shape each, mirroring backend.ts's `remote` exactly. Every one of
// these is refused by RLS if the caller is not a member acting as
// themselves, so the UI's job is to not offer what the policy would
// refuse — never to be the thing enforcing it.

export async function rankProposal(draftId: string, travelerId: string, rank: number) {
  const { error } = await supabase.from('draft_rankings')
    .upsert({ draft_id: draftId, traveler_id: travelerId, rank, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function respondToDates(draftId: string, travelerId: string, response: 'works' | 'conflict') {
  const { error } = await supabase.from('draft_date_responses')
    .upsert({ draft_id: draftId, traveler_id: travelerId, response, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function postComment(args: {
  tripId: string; travelerId: string; text: string; draftId?: string | null; replyToId?: string | null;
}) {
  const { error } = await supabase.from('comments').insert({
    trip_id: args.tripId, traveler_id: args.travelerId, body: args.text,
    needs_decision: false, reply_to_id: args.replyToId ?? null, draft_id: args.draftId ?? null,
  });
  if (error) throw error;
}

export async function likeComment(commentId: string, travelerId: string, liked: boolean) {
  const { error } = liked
    ? await supabase.from('comment_likes').insert({ comment_id: commentId, traveler_id: travelerId })
    : await supabase.from('comment_likes').delete().eq('comment_id', commentId).eq('traveler_id', travelerId);
  if (error) throw error;
}

export async function reportComment(tripId: string, commentId: string, reporterId: string, reason: string) {
  const { error } = await supabase.from('content_reports')
    .insert({ trip_id: tripId, comment_id: commentId, reporter_id: reporterId, reason });
  if (error) throw error;
}

/** trip_members.availability is the one column the client may update there. */
export async function setAvailability(tripId: string, travelerId: string, note: string) {
  const { error } = await supabase.from('trip_members')
    .update({ availability: note }).eq('trip_id', tripId).eq('traveler_id', travelerId);
  if (error) throw error;
}

export async function claimTask(tripId: string, taskKey: string, travelerId: string) {
  const { error } = await supabase.from('claims')
    .insert({ trip_id: tripId, task_key: taskKey, traveler_id: travelerId });
  if (error) throw error;
}

export async function unclaimTask(tripId: string, taskKey: string) {
  const { error } = await supabase.from('claims').delete().eq('trip_id', tripId).eq('task_key', taskKey);
  if (error) throw error;
}

export async function setTaskBooked(tripId: string, taskKey: string, booked: boolean) {
  const { error } = await supabase.rpc('set_claim_booked', {
    p_trip_id: tripId, p_task_key: taskKey, p_booked: booked,
  });
  if (error) throw error;
}

/** Lock or reopen. Symmetric and any-member, same as the app (20260831170000). */
export async function decideTrip(tripId: string, draftId: string | null) {
  const { error } = await supabase.rpc('decide_trip', {
    p_trip_id: tripId, p_draft_id: draftId, p_how: 'manual',
  });
  if (error) throw error;
}

export async function leaveTrip(tripId: string, travelerId: string) {
  const { error } = await supabase.rpc('leave_trip', { p_trip_id: tripId, p_traveler_id: travelerId });
  if (error) throw error;
}

/**
 * Same tables and the same coarse "any change, refetch everything" model
 * as backend.ts's app-sync channel — per-trip volumes are tiny, and a
 * refetch cannot drift the way a patch can. Debounced so a burst of
 * changes costs one round trip.
 */
const SYNCED_TABLES = [
  'trips', 'trip_members', 'drafts', 'draft_rankings', 'draft_date_responses',
  'comments', 'comment_likes', 'claims', 'draft_externals',
] as const;

export function subscribeTrip(onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(onChange, 400);
  };
  const ch = supabase.channel('web-trip-sync');
  for (const table of SYNCED_TABLES) {
    ch.on('postgres_changes', { event: '*', schema: 'public', table }, schedule);
  }
  ch.subscribe();
  // A browser tab restored from bfcache can hold a socket that believes it
  // is joined and is not; refetch on return rather than trusting it.
  const onVisible = () => { if (document.visibilityState === 'visible') schedule(); };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    if (timer) clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
    supabase.removeChannel(ch);
  };
}
