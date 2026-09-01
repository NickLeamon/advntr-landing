/**
 * Publishable/anon key — safe to embed client-side, the same one index.html,
 * invite.html and dashboard.html at the repo root already carry (and the
 * app ships; see adventure/.env.example). RLS protects data, not key
 * secrecy. Defaults are the production project so a Vercel build needs no
 * env vars; override with VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY for a
 * local build against QA.
 */
export const SUPABASE_URL: string =
  import.meta.env.VITE_SUPABASE_URL || 'https://vjsgvkercbtyzpdauswo.supabase.co';
export const SUPABASE_ANON_KEY: string =
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_UM19CZ6ExmxXyzsgn4Flbg_KmLMIMXz';

/** Public TestFlight link, serving the moderated build — same as invite.html. */
export const STORE_URL = 'https://testflight.apple.com/join/TGDbMpqf';

/** Custom scheme the app registers; the explicit "open it in the app" door. */
export const APP_SCHEME_JOIN = (inviteId: string) => `advntr://join/${inviteId}`;

/**
 * Phase 3 gate (docs/web-trip-sharing-spec.md §7). Off until the Google
 * provider is enabled on the Supabase project — a sign-in button that
 * errors is worse than no button. Flip with VITE_WEB_JOIN_ENABLED=1.
 */
export const WEB_JOIN_ENABLED = import.meta.env.VITE_WEB_JOIN_ENABLED === '1';
