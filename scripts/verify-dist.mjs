/**
 * Proves the build did not touch the marketing site.
 *
 * Every allowlisted static entry must exist in dist/ byte-identical to the
 * source at the repo root, and the AASA file in particular must be exactly
 * where iOS looks for it. Run after `npm run build`; exits non-zero on the
 * first mismatch. This is the gate for the phase-1 "no behaviour change"
 * claim in docs/web-trip-sharing-spec.md — a claim, not a hope.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

const ALLOWLIST = ['index.html', 'invite.html', 'privacy.html', 'dashboard.html', 'img', '.well-known'];

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗ FAIL'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

check('dist/ exists', existsSync(dist));
for (const name of ALLOWLIST) {
  const src = join(root, name);
  const out = join(dist, name);
  if (!existsSync(out)) { check(`${name} present in dist`, false); continue; }
  const files = statSync(src).isDirectory() ? walk(src) : [src];
  for (const f of files) {
    const rel = f.slice(root.length + 1);
    const built = join(dist, rel);
    check(`${rel} byte-identical`, existsSync(built) && sha(f) === sha(built));
  }
}

const aasa = join(dist, '.well-known', 'apple-app-site-association');
check('AASA served at /.well-known/apple-app-site-association', existsSync(aasa));
if (existsSync(aasa)) {
  let parsed = null;
  try { parsed = JSON.parse(readFileSync(aasa, 'utf8')); } catch {}
  check('AASA parses as JSON', !!parsed);
  check('AASA still claims /i/*', !!parsed?.applinks?.details?.some((d) => (d.paths ?? []).includes('/i/*')));
}

check('app bundle present at dist/app/index.html', existsSync(join(dist, 'app', 'index.html')));

console.log(failures ? `\n${failures} failure(s)` : '\nall good');
process.exit(failures ? 1 : 0);
