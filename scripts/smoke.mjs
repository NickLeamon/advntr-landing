/**
 * Renders dist/ the way Vercel serves it (the rewrites in vercel.json),
 * with every Supabase call intercepted and answered from fixtures, and
 * screenshots each state into smoke/. Nothing reaches the real project.
 *
 *   npm run build && npm run smoke
 *
 * Five states: proposals, a decided trip, the legacy four-field fallback
 * (what the page shows while get_trip_share_preview is not yet deployed —
 * PGRST202, verified against prod 2026-09-01), an invalid link, and a
 * failed load. Prints the visible text, the RPCs the page called in
 * order, and the analytics events it wrote — the assertions are the
 * printout: read it. Needs a Chromium; set CHROMIUM_PATH if it is not
 * at the Playwright default used here.
 */
import http from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const OUT = join(DIST, '..', 'smoke');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (/^\/(i|join)\/[^/]+\/?$/.test(p)) p = '/app/index.html';
  if (p === '/dashboard') p = '/dashboard.html';
  if (p.endsWith('/')) p += 'index.html';
  const f = join(DIST, p);
  if (!existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); res.end('nope ' + p); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
}).listen(4173);

const SHARE = {
  trip_id: 't1', trip_name: 'Boys trip 2027', cover_photo_url: null, inviter_first_name: 'Nick',
  member_count: 4, decided_draft_id: null, already_member: false,
  proposals: [
    { id: 'd1', city_id: 'lisbon', city_name: 'Lisbon', country: 'Portugal', state: null, hero_image_url: 'http://localhost:4173/img/02-triphome.jpg', hero_gallery: [], days: 5, activity_count: 4, has_stay: true, rating_count: 3, rating_avg: 4.33, is_decided: false },
    { id: 'd2', city_id: 'porto', city_name: 'Porto', country: 'Portugal', state: null, hero_image_url: 'http://x/Flag_of_Porto.svg', hero_gallery: [{ url: 'http://localhost:4173/img/03-proposal.jpg' }], days: 4, activity_count: 2, has_stay: false, rating_count: 2, rating_avg: 3.5, is_decided: false },
    { id: 'd3', city_id: 'austin', city_name: 'Austin', country: 'USA', state: 'Texas', hero_image_url: null, hero_gallery: [], days: 3, activity_count: 0, has_stay: false, rating_count: 0, rating_avg: null, is_decided: false },
  ],
};
const DECIDED = { ...SHARE, decided_draft_id: 'd1', proposals: SHARE.proposals.map((p) => ({ ...p, is_decided: p.id === 'd1' })) };
const LEGACY = [{ trip_id: 't1', trip_name: 'Boys trip 2027', inviter_first_name: 'Nick', member_count: 4, draft_count: 3, already_member: false }];

const scenarios = {
  share: { share: { status: 200, body: SHARE } },
  decided: { share: { status: 200, body: DECIDED } },
  legacy: { share: { status: 404, body: { code: 'PGRST202', message: 'Could not find the function' } }, invite: { status: 200, body: LEGACY } },
  invalid: { share: { status: 200, body: null } },
  failed: { share: { status: 500, body: { code: 'XX000', message: 'boom' } } },
};

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const results = {};
for (const [name, s] of Object.entries(scenarios)) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const calls = [];
  await page.route('**/vjsgvkercbtyzpdauswo.supabase.co/**', (route) => {
    const u = route.request().url();
    const body = route.request().postData();
    calls.push({ url: u.replace(/^.*supabase\.co/, ''), body });
    if (u.includes('/rpc/get_trip_share_preview')) return route.fulfill({ status: s.share.status, contentType: 'application/json', body: JSON.stringify(s.share.body) });
    if (u.includes('/rpc/get_invite_preview') && s.invite) return route.fulfill({ status: s.invite.status, contentType: 'application/json', body: JSON.stringify(s.invite.body) });
    if (u.includes('/rest/v1/analytics_events')) return route.fulfill({ status: 201, body: '' });
    return route.fulfill({ status: 500, body: 'unexpected ' + u });
  });
  await page.goto('http://localhost:4173/i/abc-123');
  await page.waitForFunction(() => !document.body.innerText.includes('Loading the trip'), null, { timeout: 5000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, `shot-${name}.png`), fullPage: true });
  const text = await page.evaluate(() => document.body.innerText);
  const events = calls.filter((c) => c.url.includes('analytics_events')).map((c) => JSON.parse(c.body));
  results[name] = { text: text.replace(/\n+/g, ' | ').slice(0, 400), rpcs: calls.filter((c) => c.url.includes('/rpc/')).map((c) => c.url + ' ' + c.body), events: events.map((e) => `${e.kind} ${JSON.stringify(e.payload)}`) };
  await page.close();
}
// Contract checks, so a regression fails the run rather than just changing the printout.
const must = (ok, why) => { if (!ok) { console.error('SMOKE FAIL:', why); process.exitCode = 1; } };
must(results.share.rpcs.length === 1 && results.share.rpcs[0].includes('get_trip_share_preview'), 'share path must call only get_trip_share_preview');
must(results.legacy.rpcs.length === 2 && results.legacy.rpcs[1].includes('get_invite_preview'), 'PGRST202 must fall back to get_invite_preview');
must(results.share.events.some((e) => e.startsWith('invite_opened')), 'found must write invite_opened');
must(results.invalid.events.some((e) => e.startsWith('invite_invalid')), 'invalid must write invite_invalid');
must(results.failed.events.some((e) => e.startsWith('invite_load_failed')), 'failed must write invite_load_failed');
must(results.share.text.includes('LEADING') && results.decided.text.includes('THE PICK'), 'leader/decided badges');
must(results.share.text.includes('Porto, Portugal'), 'junk flag hero must fall back to gallery and still render the card');
await browser.close();
server.close();
for (const [k, v] of Object.entries(results)) { console.log(`\n=== ${k} ===`); console.log('TEXT:', v.text); console.log('RPCS:', v.rpcs); console.log('EVENTS:', v.events); }
