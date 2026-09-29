/**
 * Runtime configuration. Expo inlines `EXPO_PUBLIC_*` variables at bundle time
 * (they must be referenced as literal `process.env.EXPO_PUBLIC_X`).
 * Only public values belong here: never put the Supabase service-role key in the app.
 */
declare const process: { env: Record<string, string | undefined> };

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export const API_URL = trimSlash(
  process.env.EXPO_PUBLIC_API_URL || (__DEV__ ? 'http://localhost:3001' : 'https://api.oxacan.ch'),
);

/** May point at a proxy when *.supabase.co is blocked on the network. */
export const SUPABASE_URL = trimSlash(process.env.EXPO_PUBLIC_SUPABASE_URL || '');
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

export const isAuthConfigured = SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
