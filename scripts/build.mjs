/**
 * One build for one Vercel project.
 *
 * The marketing site has no build step and never did: index.html,
 * privacy.html and friends are served as-is from the repo root, and
 * /.well-known/apple-app-site-association is load-bearing for every
 * invite link already in the wild (Apple fetches it at install time; if
 * it stops being served, universal links stop resolving). The web trip
 * view (app/) is a Vite build. Rather than move the static files into a
 * source directory — a change to a live site for no user benefit — this
 * script copies an explicit allowlist of them into dist/ verbatim, then
 * builds the app into dist/app/. Additive only: nothing at the root moves.
 *
 * The allowlist is deliberate. Anything not named here does not ship —
 * README.md, .claude/, this scripts/ directory, vercel.json (Vercel reads
 * that from the source root, not the output).
 */
import { cpSync, mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

// Files and directories served verbatim from the site root.
export const STATIC_ALLOWLIST = [
  'index.html',
  'invite.html',
  'privacy.html',
  'dashboard.html',
  'img',
  '.well-known',
];

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

for (const name of STATIC_ALLOWLIST) {
  const from = join(root, name);
  if (!existsSync(from)) throw new Error(`build: allowlisted static entry missing: ${name}`);
  cpSync(from, join(dist, name), { recursive: statSync(from).isDirectory() });
  console.log(`  static  ${name}`);
}

// Vite emits into dist/app with base '/app/' (app/vite.config.ts); the
// rewrites in vercel.json point /i/:id at dist/app/index.html.
execSync('npx vite build', { cwd: join(root, 'app'), stdio: 'inherit' });
console.log('build: ok');
