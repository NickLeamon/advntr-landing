# advntr landing page

Marketing site for **advntr** — get your trips out of the groupchat — plus
the web trip view a share link opens in.

Two things, one Vercel project:

- **The marketing site** — `index.html`, `privacy.html`, `dashboard.html`,
  `img/`, `.well-known/`. Static, no build step, served verbatim from the
  repo root. `invite.html` is the previous share-link page, kept for
  rollback (point the `/i/:id` rewrite in `vercel.json` back at it).
- **The web trip view** — `app/`, a Vite + React app served from `/app/`.
  `/i/:id` and `/join/:id` rewrite to it. It's what a share link shows
  someone with no app: read-only until they sign in, then a real member —
  rate every proposal, answer on the dates, argue in the thread, claim a
  booking duty, lock the trip in. Proposing stays in the app, permanently.
  Spec, decisions and phasing live in the adventure repo:
  `docs/web-trip-sharing-spec.md`.

```
npm ci
npm run build        # scripts/build.mjs: copies the static allowlist into dist/, builds app/ into dist/app/
npm run verify:dist  # proves the static files came through byte-identical, AASA included
npm run smoke        # signed-out states in Chromium against fixtures -> smoke/
npm run smoke:member # member + decided states, same way
npm run verify:live  # the real data layer against the live project (creates and deletes its own trip)
npm run dev          # Vite dev server for app/ (open /i/<some-invite-id>)
```

`verify:live` bundles `app/src/lib/trip.ts` and `session.ts` for node with
esbuild and runs *them*, not a replica, against the live project using the
seeded dev-tester accounts — so a wrong column or a write RLS refuses
fails there. The browser harnesses use fixtures because a page in this
sandbox cannot reach Supabase (the egress proxy's CA is not in Chromium's
root store). Data layer proven against real rows, DOM against fixtures.

The build is additive on purpose: nothing at the repo root moves, so
`/.well-known/apple-app-site-association` keeps being served from exactly
where iOS looks for it.

The app talks to the production Supabase project by default (same
publishable key the static pages embed — RLS protects data, not key
secrecy). `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` override it for a
local build against QA. `VITE_WEB_JOIN_ENABLED=1` turns on the web join
flow; it is off by default because a Google button that errors before the
provider exists is worse than no button.

Screenshots in `img/` are captured from the app running in the iOS
Simulator. The main app lives in the `adventure` repo.
