/**
 * The member surface's data layer, against the LIVE project.
 *
 *   node scripts/verify-live.mjs
 *
 * Same footing as adventure's scripts/verify-invite.mjs: the anon key plus
 * the seeded dev-tester accounts, no service role, no CLI. It creates its
 * own trip, draft and invite as Sam, joins as Alex through the real
 * redeem path, exercises every write the web member surface offers, and
 * deletes everything it made — pass or fail.
 *
 * It runs src/lib/trip.ts and src/lib/session.ts THEMSELVES, bundled for
 * node by esbuild, rather than a hand-written replica of their calls. A
 * replica is the thing most likely to differ from the app, so it would
 * verify the wrong artifact: a wrong column name or a write RLS refuses
 * has to fail here, and it can only do that if this is the same code.
 *
 * Rendering is covered separately by scripts/smoke.mjs, which drives the
 * real built page in Chromium against fixtures. Driving the browser
 * against the LIVE backend would be better still and is not possible in
 * this sandbox: outbound HTTPS goes through a proxy whose CA Chromium's
 * root store will not take, so every request from the page hangs. Node
 * trusts it, which is why the data layer is verified here and the DOM
 * there. Neither half is assumed.
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://vjsgvkercbtyzpdauswo.supabase.co';
const ANON = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_UM19CZ6ExmxXyzsgn4Flbg_KmLMIMXz';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// ——— bundle the real modules for node ————————————————————————————————————
// import.meta.env is a Vite compile-time construct; esbuild's --define
// substitutes the same values Vite would, so the modules under test are
// byte-for-byte what the browser runs apart from that substitution.
const appDir = new URL('../app', import.meta.url).pathname;
const out = join(mkdtempSync(join(tmpdir(), 'advntr-verify-')), 'bundle.mjs');
// Has to sit inside app/src so esbuild resolves the relative imports the
// modules under test use. Generated, gitignored, and removed below.
const entry = join(appDir, 'src', '__verify_entry.ts');
writeFileSync(entry, `export * from './lib/trip';\nexport * from './lib/session';\nexport { supabase } from './lib/supabase';\n`);
const build = spawnSync('npx', [
  'esbuild', entry, '--bundle', '--platform=node', '--format=esm', `--outfile=${out}`,
  `--define:import.meta.env.DEV=true`,
  `--define:import.meta.env.VITE_SUPABASE_URL=${JSON.stringify(SUPABASE_URL)}`,
  `--define:import.meta.env.VITE_SUPABASE_ANON_KEY=${JSON.stringify(ANON)}`,
  `--define:import.meta.env.VITE_WEB_JOIN_ENABLED="1"`,
], { cwd: appDir, encoding: 'utf8' });
if (build.status !== 0) {
  console.error(build.stderr || build.stdout);
  process.exit(1);
}
rmSync(entry, { force: true });
const app = await import(out);

// The bundled client persists sessions to localStorage, which node has
// not got; a tiny in-memory stand-in keeps supabase-js on its normal path
// instead of changing the client under test.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => void store.set(k, String(v)),
  removeItem: (k) => void store.delete(k),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};

const admin = (label) => createClient(SUPABASE_URL, ANON, { auth: { persistSession: false, storageKey: `verify-${label}` } });

async function signInAside(name) {
  const client = admin(name);
  const { data, error } = await client.auth.signInWithPassword({
    email: `dev-${name.toLowerCase()}@advntr-dev.example.com`, password: 'advntr-dev-tester-1!',
  });
  if (error) throw new Error(`sign-in ${name}: ${error.message}`);
  const { data: traveler } = await client.from('travelers').select('*').eq('user_id', data.user.id).maybeSingle();
  if (!traveler) throw new Error(`no traveler row for ${name}`);
  return { client, traveler };
}

let Sam, tripId;
try {
  Sam = await signInAside('Sam');
  console.log(`Sam = ${Sam.traveler.id.slice(0, 8)}`);

  // ——— a trip Alex is NOT on, so the join is the real thing ————————————
  tripId = randomUUID();
  const TRIP_NAME = `verify-web ${Date.now()}`;
  const startDate = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
  await Sam.client.from('trips').insert({ id: tripId, name: TRIP_NAME, created_by: Sam.traveler.id });
  await Sam.client.from('trip_members').insert({ trip_id: tripId, traveler_id: Sam.traveler.id });

  const { data: cities } = await Sam.client.from('catalog_destinations')
    .select('id,name,country').not('hero_image_url', 'is', null).limit(1);
  const city = cities?.[0];
  check('a real catalog destination to propose', !!city);

  const { data: acts } = await Sam.client.from('catalog_activities')
    .select('id,title').eq('destination_id', city.id).limit(2);
  const activityIds = (acts ?? []).map((a) => a.id);

  const draftId = randomUUID();
  const { error: draftErr } = await Sam.client.from('drafts').insert({
    id: draftId, trip_id: tripId, city_id: city.id, days: 5, start_date: startDate,
    activity_ids: activityIds, created_by: Sam.traveler.id,
  });
  check('Sam proposes a draft', !draftErr, draftErr?.message);
  const externalId = randomUUID();
  await Sam.client.from('draft_externals').insert({
    id: externalId, draft_id: draftId, kind: 'stay', url: null,
    title: 'The villa Dad found', price: null, note: null, added_by: Sam.traveler.id,
  });
  await Sam.client.from('draft_rankings').upsert({ draft_id: draftId, traveler_id: Sam.traveler.id, rank: 5 });

  const { data: invite } = await Sam.client.from('trip_invites')
    .insert({ trip_id: tripId, created_by: Sam.traveler.id }).select('id').single();
  check('Sam creates a share link', !!invite?.id);

  // ——— join, as the web app does it ——————————————————————————————————————
  console.log('\njoin flow (src/lib/session.ts)');
  const { error: authErr } = await app.devSignIn('Alex');
  check('dev sign-in gives a real session', !authErr, authErr ?? '');
  const me = await app.loadMe();
  check('loadMe resolves the travelers row', !!me?.travelerId, JSON.stringify(me));

  const claimInfo = await app.loadClaimInfo(invite.id);
  check('generic link has no placeholder to claim', claimInfo.targetName === null, JSON.stringify(claimInfo));

  const returnedTripId = await app.redeemInvite({
    inviteId: invite.id, claimPlaceholder: false, name: me.name || 'Alex', departureCityId: 'lisbon',
  });
  check('redeemInvite returns the trip id', returnedTripId === tripId, returnedTripId);
  const { data: memberRow } = await Sam.client.from('trip_members')
    .select('*').eq('trip_id', tripId).eq('traveler_id', me.travelerId).maybeSingle();
  check('the joiner is now in trip_members', !!memberRow);
  const { data: joinerRow } = await Sam.client.from('travelers')
    .select('departure_city_id').eq('id', me.travelerId).single();
  check('FR60: departure city set in the redeem transaction', joinerRow?.departure_city_id === 'lisbon', joinerRow?.departure_city_id);

  // ——— read ——————————————————————————————————————————————————————————————
  console.log('\nloadTrip (src/lib/trip.ts)');
  let trip = await app.loadTrip(tripId);
  check('loadTrip returns the trip', trip?.name === TRIP_NAME, trip?.name);
  check('members include both people', trip.members.length === 2, JSON.stringify(trip.members.map((m) => m.name)));
  const prop = trip.proposals[0];
  check('proposal resolves the real city name', prop?.cityName === city.name, prop?.cityName);
  check('proposal carries a photographic hero', typeof prop?.image === 'string' && prop.image.length > 0);
  check('proposal carries the start date', prop?.startDate === startDate, prop?.startDate);
  check('proposal counts catalog + external activities', prop?.activityCount === activityIds.length, String(prop?.activityCount));
  check('proposal resolves activity titles', prop?.activityTitles.length === activityIds.length, JSON.stringify(prop?.activityTitles));
  check('proposal carries the external stay', prop?.externals.some((e) => e.title === 'The villa Dad found'));
  check("Sam's existing rating is visible", prop?.rankings[Sam.traveler.id] === 5, JSON.stringify(prop?.rankings));
  check('proposalScore matches the app rule (mean)', app.proposalScore(prop).score === 5, JSON.stringify(app.proposalScore(prop)));

  // ——— writes ————————————————————————————————————————————————————————————
  console.log('\nevery write the member surface offers');
  await app.rankProposal(draftId, me.travelerId, 4);
  const { data: rank } = await Sam.client.from('draft_rankings')
    .select('rank').eq('draft_id', draftId).eq('traveler_id', me.travelerId).maybeSingle();
  check('rankProposal wrote rank=4', rank?.rank === 4, JSON.stringify(rank));

  await app.respondToDates(draftId, me.travelerId, 'conflict');
  const { data: dr } = await Sam.client.from('draft_date_responses')
    .select('response').eq('draft_id', draftId).eq('traveler_id', me.travelerId).maybeSingle();
  check('respondToDates wrote conflict', dr?.response === 'conflict', JSON.stringify(dr));

  const MSG = `verify-web ${randomUUID().slice(0, 8)}`;
  await app.postComment({ tripId, travelerId: me.travelerId, text: MSG });
  const REPLY = `verify-web reply ${randomUUID().slice(0, 8)}`;
  await app.postComment({ tripId, travelerId: me.travelerId, text: REPLY, draftId });
  const { data: msgs } = await Sam.client.from('comments').select('*').eq('trip_id', tripId);
  check('postComment wrote a trip-level message', (msgs ?? []).some((m) => m.body === MSG && m.draft_id === null));
  check('postComment tagged a proposal message', (msgs ?? []).some((m) => m.body === REPLY && m.draft_id === draftId));

  const mine = (msgs ?? []).find((m) => m.body === MSG);
  await app.likeComment(mine.id, me.travelerId, true);
  const { data: liked } = await Sam.client.from('comment_likes').select('*').eq('comment_id', mine.id);
  check('likeComment wrote a like', (liked ?? []).length === 1);
  await app.likeComment(mine.id, me.travelerId, false);
  const { data: unliked } = await Sam.client.from('comment_likes').select('*').eq('comment_id', mine.id);
  check('likeComment removes it again', (unliked ?? []).length === 0);

  const NOTE = 'out before the 15th';
  await app.setAvailability(tripId, me.travelerId, NOTE);
  const { data: mem2 } = await Sam.client.from('trip_members')
    .select('availability').eq('trip_id', tripId).eq('traveler_id', me.travelerId).maybeSingle();
  check('setAvailability wrote the note', mem2?.availability === NOTE, JSON.stringify(mem2));

  // Lock, book, reopen — group actions the app grants any member since
  // 20260831170000 made lock/unlock symmetric.
  await app.decideTrip(tripId, draftId);
  const { data: locked } = await Sam.client.from('trips').select('decided_draft_id').eq('id', tripId).single();
  check('decideTrip locked the trip from the web', locked?.decided_draft_id === draftId, JSON.stringify(locked));

  trip = await app.loadTrip(tripId);
  const decided = trip.proposals.find((p) => p.isDecided);
  check('loadTrip marks the decided proposal', !!decided);
  const taskKey = `activity:${decided.activityIds[0]}`;
  await app.claimTask(tripId, taskKey, me.travelerId);
  const { data: claims } = await Sam.client.from('claims').select('*').eq('trip_id', tripId);
  check('claimTask wrote a booking-sheet row', (claims ?? []).length === 1, JSON.stringify(claims));
  check('task key uses the app grammar (activity:<catalog id>)',
    claims?.[0]?.task_key === taskKey, `${claims?.[0]?.task_key} vs ${taskKey}`);

  await app.setTaskBooked(tripId, taskKey, true);
  const { data: booked } = await Sam.client.from('claims').select('booked_at').eq('trip_id', tripId).eq('task_key', taskKey).maybeSingle();
  check('setTaskBooked recorded booked', !!booked?.booked_at, JSON.stringify(booked));

  await app.unclaimTask(tripId, taskKey);
  const { data: gone } = await Sam.client.from('claims').select('*').eq('trip_id', tripId);
  check('unclaimTask releases it', (gone ?? []).length === 0);

  await app.decideTrip(tripId, null);
  const { data: reopened } = await Sam.client.from('trips').select('decided_draft_id').eq('id', tripId).single();
  check('decideTrip(null) reopens', reopened?.decided_draft_id == null, JSON.stringify(reopened));

  // ——— spec §5.5: a revoked link must not lock a member out ——————————————
  console.log('\nspec §5.5: revoked link, existing member');
  await Sam.client.from('trip_invites').update({ revoked_at: new Date().toISOString() }).eq('id', invite.id);
  const preview = await app.loadTrip(tripId);
  check('the member still loads their trip after the link is revoked', preview?.name === TRIP_NAME);

  // ——— RLS still says no to a non-member ————————————————————————————————
  console.log('\nRLS boundary');
  const Jo = await signInAside('Jo');
  const { data: joSees } = await Jo.client.from('trips').select('id').eq('id', tripId);
  check('a non-member cannot see the trip at all', (joSees ?? []).length === 0);
  const { error: joWrite } = await Jo.client.from('draft_rankings')
    .upsert({ draft_id: draftId, traveler_id: Jo.traveler.id, rank: 1 });
  check('a non-member cannot rate its proposals', !!joWrite, 'the write SUCCEEDED — RLS hole');
} catch (e) {
  console.error('\nthrew:', e?.message ?? e);
  failures++;
} finally {
  try {
    if (Sam && tripId) {
      const { data } = await Sam.client.from('trips').delete().eq('id', tripId).select();
      console.log(`\ncleanup: trip deleted (${(data ?? []).length} row)`);
    }
  } catch (e) { console.error('cleanup failed:', e.message); }
}

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
