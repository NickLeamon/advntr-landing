/**
 * Who the web visitor is.
 *
 * The whole design turns on this: every write in the schema routes through
 * is_trip_member() -> travelers.user_id = auth.uid(), so a web participant
 * needs a real Supabase session and a real travelers row. Google OAuth is
 * that door (spec D2). The travelers row is provisioned by the
 * on_auth_user_created trigger (adventure 20260731000000_init.sql), same
 * as it is for an Apple sign-in from the app — nothing here is web-specific.
 *
 * Sign in with Apple is deliberately NOT offered on the web: it needs a
 * Services ID and a client secret rotated every six months. Instead the
 * join screen puts "already using advntr? open it in the app" ABOVE the
 * Google button, so an existing Apple-signed-in user is routed back to the
 * identity they already have rather than creating a second one (spec
 * §6.1). Hide My Email means their addresses will not match and Supabase's
 * automatic identity linking cannot save them.
 */
import { supabase } from './supabase';
import type { Session } from '@supabase/supabase-js';

export interface Me {
  /** auth.users id. */
  userId: string;
  /** travelers.id — what every foreign key in the schema actually holds. */
  travelerId: string;
  name: string;
  departureCityId: string;
  emoji: string | null;
  avatarUrl: string | null;
}

export function onSession(cb: (s: Session | null) => void): () => void {
  supabase.auth.getSession().then(({ data }) => cb(data.session));
  const { data } = supabase.auth.onAuthStateChange((_e, s) => cb(s));
  return () => data.subscription.unsubscribe();
}

export async function signInWithGoogle(redirectTo: string): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  });
  return { error: error?.message ?? null };
}

/**
 * Dev-only, and it is a real account with a real RLS-respecting session,
 * not a bypass — the same three seeded testers AuthScreen offers behind
 * __DEV__ in the app, for the same reason: the OAuth providers cannot be
 * driven headlessly, which would otherwise leave the entire member surface
 * untestable by anyone but Nick on a device. import.meta.env.DEV is a Vite
 * compile-time constant, false in every production build, so this block
 * and the credential in it are dead-code-eliminated from what ships.
 */
export const DEV_TESTERS = ['Sam', 'Alex', 'Jo'] as const;

export async function devSignIn(name: string): Promise<{ error: string | null }> {
  if (!import.meta.env.DEV) return { error: 'dev sign-in is not available in this build' };
  const { error } = await supabase.auth.signInWithPassword({
    email: `dev-${name.toLowerCase()}@advntr-dev.example.com`,
    password: 'advntr-dev-tester-1!',
  });
  return { error: error?.message ?? null };
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

/**
 * Waits for the signup trigger to materialise the travelers row. Same
 * retry as backend.ts ensureTraveler: usually instant, briefly retried to
 * cover the race on a brand-new account.
 */
export async function loadMe(): Promise<Me> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) throw userErr ?? new Error('no auth user');
  const userId = userData.user.id;
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data, error } = await supabase
      .from('travelers')
      // `*` for the same schema-lag reason as loadTrip's reads — see the
      // comment there. avatar_url is on QA and not yet on prod.
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      return {
        userId,
        travelerId: data.id,
        name: data.name ?? '',
        departureCityId: data.departure_city_id ?? '',
        emoji: data.emoji ?? null,
        avatarUrl: data.avatar_url ?? null,
      };
    }
    await new Promise((r) => setTimeout(r, 350));
  }
  throw new Error('traveler row never appeared for this account');
}

export interface ClaimInfo {
  /** The placeholder this link was generated for, if it is still unclaimed. */
  targetName: string | null;
}

export async function loadClaimInfo(inviteId: string): Promise<ClaimInfo> {
  const { data, error } = await supabase.rpc('get_invite_claim_info', { p_invite_id: inviteId });
  if (error) throw error;
  return { targetName: (data as { target_name: string | null }[] | null)?.[0]?.target_name ?? null };
}

/**
 * The join itself. Name and departure city ride along in the same
 * transaction as the merge — FR60: an unresolved departure produces no
 * fare and is counted as a declared gap, so a joiner who skips it degrades
 * the flight estimate for everyone else on the trip.
 */
export async function redeemInvite(args: {
  inviteId: string;
  claimPlaceholder: boolean;
  name: string | null;
  departureCityId: string | null;
}): Promise<string> {
  const { data, error } = await supabase.rpc('redeem_trip_invite', {
    p_invite_id: args.inviteId,
    p_claim_placeholder: args.claimPlaceholder,
    p_name: args.name,
    p_departure_city_id: args.departureCityId,
  });
  if (error) throw error;
  return data as string;
}
