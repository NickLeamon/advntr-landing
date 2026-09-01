/**
 * The member surface and the join flow, rendered in Chromium from
 * fixtures.
 *
 *   npm run build && npm run smoke:member
 *
 * Companion to smoke.mjs (signed-out states) and verify-live.mjs (the data
 * layer against real rows). This one covers the half neither does: that
 * the signed-in DOM renders, and that the controls are reachable and
 * labelled. Fixtures rather than the live project because the sandbox
 * proxy's CA is not in Chromium's root store, so a page here cannot reach
 * Supabase — see the header of verify-live.mjs.
 *
 * The session is a real supabase-js localStorage entry with a far-future
 * expiry, so the client takes its normal authenticated path and never
 * tries to refresh.
 */
import http from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'smoke');
const PORT = 4174;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };

mkdirSync(OUT, { recursive: true });
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (/^\/(i|join)\/[^/]+\/?$/.test(p)) p = '/app/index.html';
  if (p.endsWith('/')) p += 'index.html';
  const f = join(DIST, p);
  if (!existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
}).listen(PORT);

const ME = '11111111-1111-4111-8111-111111111111';
const SAM = '22222222-2222-4222-8222-222222222222';
const GHOST = '33333333-3333-4333-8333-333333333333';
const TRIP = 'aaaaaaaa-1111-4111-8111-111111111111';
const D1 = 'dddddddd-1111-4111-8111-111111111111';
const D2 = 'dddddddd-2222-4222-8222-222222222222';
const IMG = `http://localhost:${PORT}/img/02-triphome.jpg`;
const START = '2027-06-04';

const TABLES = {
  trips: [{ id: TRIP, name: 'Boys trip 2027', budget: 2500, decided_draft_id: null, decide_deadline_at: null, cover_photo_url: null, created_by: SAM, created_at: '2026-08-01T00:00:00Z' }],
  trip_members: [
    { trip_id: TRIP, traveler_id: SAM, availability: 'any time after May', joined_at: '2026-08-01T00:00:00Z' },
    { trip_id: TRIP, traveler_id: ME, availability: '', joined_at: '2026-08-02T00:00:00Z' },
    { trip_id: TRIP, traveler_id: GHOST, availability: '', joined_at: '2026-08-03T00:00:00Z' },
  ],
  travelers: [
    { id: ME, user_id: 'u-me', name: 'Alex Rivera', emoji: null, departure_city_id: 'austin', deleted_at: null },
    { id: SAM, user_id: 'u-sam', name: 'Sam Doyle', emoji: '🏄', departure_city_id: 'nyc', deleted_at: null },
    { id: GHOST, user_id: null, name: 'Priya', emoji: null, departure_city_id: '', deleted_at: null },
  ],
  drafts: [
    { id: D1, trip_id: TRIP, city_id: 'lisbon', days: 5, start_date: START, lodging_id: 'h1', activity_ids: ['a1', 'a2'], created_by: SAM, created_at: '2026-08-02T00:00:00Z' },
    { id: D2, trip_id: TRIP, city_id: 'porto', days: 4, start_date: null, lodging_id: null, activity_ids: [], created_by: ME, created_at: '2026-08-03T00:00:00Z' },
  ],
  draft_rankings: [
    { draft_id: D1, traveler_id: SAM, rank: 5 }, { draft_id: D1, traveler_id: ME, rank: 4 },
    { draft_id: D2, traveler_id: SAM, rank: 3 },
  ],
  draft_date_responses: [{ draft_id: D1, traveler_id: SAM, response: 'works' }],
  comments: [
    { id: 'c1', trip_id: TRIP, traveler_id: SAM, body: 'Lisbon in June is perfect. Booking flexible fares either way.', needs_decision: false, reply_to_id: null, draft_id: null, created_at: new Date(Date.now() - 7200000).toISOString() },
    { id: 'c2', trip_id: TRIP, traveler_id: SAM, body: 'The surf place is a 10 min walk from the flat.', needs_decision: false, reply_to_id: null, draft_id: D1, created_at: new Date(Date.now() - 3600000).toISOString() },
  ],
  comment_likes: [{ comment_id: 'c1', traveler_id: ME }],
  claims: [],
  draft_externals: [{ id: 'x1', draft_id: D1, kind: 'stay', url: null, title: 'The villa Dad found', price: null, note: 'he is sorting it', added_by: SAM, created_at: '2026-08-02T00:00:00Z' }],
  catalog_destinations: [
    { id: 'lisbon', name: 'Lisbon', country: 'Portugal', state: null, hero_image_url: IMG, hero_gallery: [] },
    { id: 'porto', name: 'Porto', country: 'Portugal', state: null, hero_image_url: 'http://x/Flag_of_Porto.svg', hero_gallery: [{ url: `http://localhost:${PORT}/img/03-proposal.jpg` }] },
  ],
  catalog_lodging: [{ id: 'h1', name: 'Casa do Bairro' }],
  catalog_activities: [{ id: 'a1', title: 'Sunset surf lesson at Costa da Caparica' }, { id: 'a2', title: 'Time Out Market food crawl' }],
};

const SESSION = {
  access_token: 'fake', token_type: 'bearer', expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 86400 * 365,
  refresh_token: 'fake', user: { id: 'u-me', aud: 'authenticated', role: 'authenticated', email: 'alex@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
};

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });

async function render({ name, signedIn, decided }) {
  const page = await browser.newPage({ viewport: { width: 390, height: 900 }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => { console.error(`  ${name} page error:`, e.message); process.exitCode = 1; });
  const tables = structuredClone(TABLES);
  if (decided) tables.trips[0].decided_draft_id = D1;

  if (signedIn) {
    await page.addInitScript((s) => {
      // supabase-js keys its session by project ref.
      localStorage.setItem('sb-vjsgvkercbtyzpdauswo-auth-token', JSON.stringify(s));
    }, SESSION);
  }

  await page.route('**/vjsgvkercbtyzpdauswo.supabase.co/**', async (route) => {
    const u = new URL(route.request().url());
    const json = (b, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(b) });
    if (u.pathname.startsWith('/auth/v1/user')) return json(SESSION.user);
    if (u.pathname.startsWith('/auth/v1/')) return json(SESSION);
    if (u.pathname === '/rest/v1/analytics_events') return route.fulfill({ status: 201, body: '' });
    if (u.pathname === '/rest/v1/rpc/get_trip_share_preview') {
      return json({
        trip_id: TRIP, trip_name: 'Boys trip 2027', cover_photo_url: null, inviter_first_name: 'Sam',
        member_count: 2, decided_draft_id: decided ? D1 : null, already_member: signedIn,
        proposals: [
          { id: D1, city_id: 'lisbon', city_name: 'Lisbon', country: 'Portugal', state: null, hero_image_url: IMG, hero_gallery: [], days: 5, activity_count: 3, has_stay: true, rating_count: 2, rating_avg: 4.5, is_decided: !!decided },
          { id: D2, city_id: 'porto', city_name: 'Porto', country: 'Portugal', state: null, hero_image_url: null, hero_gallery: [], days: 4, activity_count: 0, has_stay: false, rating_count: 1, rating_avg: 3, is_decided: false },
        ],
      });
    }
    if (u.pathname === '/rest/v1/rpc/get_invite_claim_info') return json([{ target_name: null }]);
    const table = u.pathname.replace('/rest/v1/', '');
    if (route.request().method() !== 'GET') return json([], 201);
    let rows = tables[table] ?? [];
    // Honour the eq/in filters the app sends, so a bad filter shows up here.
    for (const [key, raw] of u.searchParams) {
      if (key === 'select' || key === 'order' || key === 'limit') continue;
      const m = /^(eq|in)\.(.*)$/s.exec(raw);
      if (!m) continue;
      const wanted = m[1] === 'eq' ? [m[2]] : m[2].replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/^"|"$/g, ''));
      rows = rows.filter((r) => wanted.includes(String(r[key])));
    }
    return json(rows);
  });

  await page.goto(`http://localhost:${PORT}/i/abc-123`);
  await page.waitForFunction(() => !/Loading/.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(OUT, `member-${name}.png`), fullPage: true });
  const text = await page.evaluate(() => document.body.innerText);
  const controls = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || b.textContent.trim()).filter(Boolean));
  await page.close();
  return { text, controls };
}

const results = {};
results.member = await render({ name: 'open', signedIn: true, decided: false });
results.decided = await render({ name: 'decided', signedIn: true, decided: true });

const must = (ok, why) => { if (!ok) { console.error('SMOKE FAIL:', why); process.exitCode = 1; } };
// Section titles and tags are uppercased in CSS, and innerText returns the
// rendered casing — so content assertions compare case-insensitively.
const said = (r, s) => r.text.toLowerCase().includes(s.toLowerCase());
for (const [k, v] of Object.entries(results)) {
  console.log(`\n=== ${k} ===`);
  console.log('TEXT:', v.text.replace(/\n+/g, ' | ').slice(0, 520));
}
must(said(results.member, 'Boys trip 2027'), 'member sees the trip name');
must(results.member.text.includes('Lisbon, Portugal') && results.member.text.includes('Porto, Portugal'), 'both proposals render');
must(results.member.controls.includes('4 out of 5'), 'the rating control is present and labelled');
must(results.member.text.includes('Works for me') && results.member.text.includes('Conflict'), 'the date controls render');
must(results.member.text.includes('Sam Doyle') && results.member.text.includes('Priya'), 'the roster renders, placeholders included');
must(said(results.member, 'invited'), 'a placeholder is marked as not yet joined');
must(results.member.text.includes('any time after May'), "another member's availability shows");
must(results.member.text.includes('Lisbon in June is perfect'), 'the thread renders');
must(results.member.text.includes('Get advntr to propose a place'), 'proposing routes to the app');
must(!/\$\d/.test(results.member.text), 'no price is shown on the web (FR62)');
must(said(results.decided, 'the pick'), 'decided state shows the pick');
must(said(results.decided, 'who books what'), 'decided state shows the booking sheet');
must(results.decided.text.includes('Casa do Bairro'), 'the booking sheet lists the stay');
must(results.decided.controls.some((c) => c.includes('Reopen')), 'reopen is offered');

await browser.close();
server.close();
console.log(process.exitCode ? '\nfailures' : '\nall good');
