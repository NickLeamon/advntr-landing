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
  someone with no app: the trip's proposals, read-only, and two explicit
  doors — TestFlight, or open the app you have. Spec and phasing live in
  the adventure repo: `docs/web-trip-sharing-spec.md`.

```
npm ci
npm run build        # scripts/build.mjs: copies the static allowlist into dist/, builds app/ into dist/app/
npm run verify:dist  # proves the static files came through byte-identical, AASA included
npm run smoke        # renders dist/ in Chromium with mocked Supabase, screenshots into smoke/
npm run dev          # Vite dev server for app/ (open /i/<some-invite-id>)
```

The build is additive on purpose: nothing at the repo root moves, so
`/.well-known/apple-app-site-association` keeps being served from exactly
where iOS looks for it.

The app talks to the production Supabase project by default (same
publishable key the static pages embed — RLS protects data, not key
secrecy). `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` override it for a
local build against QA. `VITE_WEB_JOIN_ENABLED=1` turns on the web join
flow once the Google provider is enabled on the project.

Screenshots in `img/` are captured from the app running in the iOS
Simulator. The main app lives in the `adventure` repo.
