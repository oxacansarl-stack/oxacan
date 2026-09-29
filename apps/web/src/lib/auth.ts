import { createClient, SupabaseClient } from '@supabase/supabase-js';

const DEV_TOKEN_KEY = 'oxacan_token';
export const UNAUTHORIZED_EVENT = 'oxacan:unauthorized';

const configuredUrl = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
// Optionally reached through our own origin (Vite proxy in dev, Caddy in production) so networks
// that block *.supabase.co can still sign in.
const url = import.meta.env.VITE_SUPABASE_VIA_PROXY && configuredUrl ? `${window.location.origin}/supabase` : configuredUrl;

export const supabase: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          // Keep the session key tied to the real project, not the proxy origin.
          storageKey: `sb-${new URL(configuredUrl).hostname.split('.')[0]}-auth-token`,
        },
      })
    : null;

/** Dev tokens (from `npm run db:seed -w apps/api`) are honoured only in dev builds. */
function readDevToken(): string | null {
  if (!import.meta.env.DEV) return null;
  try {
    return localStorage.getItem(DEV_TOKEN_KEY);
  } catch {
    return null;
  }
}

export async function getAccessToken(): Promise<string | null> {
  const dev = readDevToken();
  if (dev) return dev;
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  if (!supabase) throw new Error('Sign-in is not configured (missing SUPABASE_URL / SUPABASE_ANON_KEY).');
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}

export function signInWithDevToken(token: string): void {
  localStorage.setItem(DEV_TOKEN_KEY, token.trim());
}

export async function signOut(): Promise<void> {
  try {
    localStorage.removeItem(DEV_TOKEN_KEY);
  } catch {
    /* storage unavailable */
  }
  if (supabase) await supabase.auth.signOut();
}

/** Calls back when Supabase reports the session ended (sign-out elsewhere, refresh failure). */
export function onSignedOut(cb: () => void): () => void {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') cb();
  });
  return () => data.subscription.unsubscribe();
}
