import 'react-native-url-polyfill/auto';
import { AppState } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createClient, type SupportedStorage } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL, isAuthConfigured } from './config';

/**
 * Session storage: Keychain / Keystore via expo-secure-store.
 *
 * The Supabase session (access JWT + refresh token + user object) is usually
 * larger than SecureStore's ~2 KB per-value limit, so the value is split into
 * chunks: `<key>.n` holds the chunk count and `<key>.0..n-1` the pieces.
 * We deliberately do not fall back to AsyncStorage, which is unencrypted and
 * would expose the refresh token on a lost/rooted device.
 */
const CHUNK_SIZE = 1800;
const countKey = (key: string) => `${key}.n`;
const chunkKey = (key: string, i: number) => `${key}.${i}`;

async function removeChunks(key: string): Promise<void> {
  const n = parseInt((await SecureStore.getItemAsync(countKey(key))) ?? '0', 10) || 0;
  for (let i = 0; i < n; i++) {
    await SecureStore.deleteItemAsync(chunkKey(key, i));
  }
  await SecureStore.deleteItemAsync(countKey(key));
}

export const chunkedSecureStorage: SupportedStorage = {
  async getItem(key) {
    const n = parseInt((await SecureStore.getItemAsync(countKey(key))) ?? '', 10);
    if (!Number.isFinite(n) || n <= 0) return null;
    let value = '';
    for (let i = 0; i < n; i++) {
      const part = await SecureStore.getItemAsync(chunkKey(key, i));
      if (part === null) return null; // partial write: treat as signed out
      value += part;
    }
    return value;
  },
  async setItem(key, value) {
    await removeChunks(key);
    const n = Math.ceil(value.length / CHUNK_SIZE);
    for (let i = 0; i < n; i++) {
      await SecureStore.setItemAsync(chunkKey(key, i), value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
    }
    await SecureStore.setItemAsync(countKey(key), String(n));
  },
  async removeItem(key) {
    await removeChunks(key);
  },
};

// Placeholder URL keeps createClient from throwing when env is missing; the
// login screen shows a configuration error in that case instead.
export const supabase = createClient(
  SUPABASE_URL || 'http://supabase.invalid',
  SUPABASE_ANON_KEY || 'missing-anon-key',
  {
    auth: {
      storage: chunkedSecureStorage,
      // Fixed key (SecureStore keys allow only [A-Za-z0-9._-]) and independent of the proxy host.
      storageKey: 'oxacan.auth',
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);

// Only refresh tokens while the app is in the foreground (recommended for RN).
if (isAuthConfigured) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

/** Current access token, refreshed by supabase-js if it is about to expire. */
export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
