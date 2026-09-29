import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { api, ApiError, errorMessage, setUnauthorizedHandler } from '../lib/api';
import { isAuthConfigured } from '../lib/config';
import type { Profile } from '../lib/types';

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn' | 'profileError';

interface AuthContextValue {
  status: AuthStatus;
  profile: Profile | null;
  /** Message shown on the login screen (why the user was signed out). */
  notice: string | null;
  /** Set when the profile could not be loaded for a reason other than 401. */
  profileError: string | null;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: (notice?: string) => Promise<void>;
  retryProfile: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const NOT_SET_UP_MESSAGE =
  'Your account is not set up in OXACAN yet. Please contact your administrator.';
const SESSION_EXPIRED_MESSAGE = 'Your session has expired. Please sign in again.';

/**
 * Non-sensitive profile cache (name, role, ids) so a worker who opens the app
 * without signal can still clock in; the tokens themselves stay in SecureStore.
 */
const PROFILE_CACHE_KEY = 'oxacan_profile_cache';

async function readCachedProfile(authUserId: string): Promise<Profile | null> {
  try {
    const raw = await AsyncStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as { authUserId: string; profile: Profile };
    return cached.authUserId === authUserId ? cached.profile : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [notice, setNotice] = useState<string | null>(
    isAuthConfigured ? null : 'The app is not configured: set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.',
  );
  const [profileError, setProfileError] = useState<string | null>(null);

  const authUserId = useRef<string | null>(null);
  const statusRef = useRef<AuthStatus>('loading');
  statusRef.current = status;

  const signOut = useCallback(async (message?: string) => {
    authUserId.current = null;
    setProfile(null);
    setProfileError(null);
    setNotice(message ?? null);
    setStatus('signedOut');
    await AsyncStorage.removeItem(PROFILE_CACHE_KEY).catch(() => undefined);
    // Removes the stored session even if the revoke call fails (e.g. offline).
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
  }, []);

  const loadProfile = useCallback(
    async (userId: string) => {
      setStatus('loading');
      setProfileError(null);
      try {
        const p = await api<Profile>('/auth/profile');
        if (authUserId.current !== userId) return; // signed out meanwhile
        setProfile(p);
        setStatus('signedIn');
        await AsyncStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({ authUserId: userId, profile: p }));
      } catch (err) {
        if (authUserId.current !== userId) return;
        if (err instanceof ApiError && err.status === 401) {
          await signOut(NOT_SET_UP_MESSAGE);
          return;
        }
        if (err instanceof ApiError && err.isNetwork) {
          const cached = await readCachedProfile(userId);
          if (cached) {
            setProfile(cached);
            setStatus('signedIn');
            return;
          }
        }
        setProfileError(errorMessage(err));
        setStatus('profileError');
      }
    },
    [signOut],
  );

  useEffect(() => {
    // Any 401 outside the profile load means the session is no longer valid.
    setUnauthorizedHandler((path) => {
      if (path === '/auth/profile' || statusRef.current === 'signedOut') return;
      void signOut(SESSION_EXPIRED_MESSAGE);
    });

    const handleSession = (userId: string | null) => {
      if (!userId) {
        if (authUserId.current !== null || statusRef.current === 'loading') {
          authUserId.current = null;
          setProfile(null);
          setStatus('signedOut');
        }
        return;
      }
      if (authUserId.current === userId) return; // token refresh, same user
      authUserId.current = userId;
      void loadProfile(userId);
    };

    if (!isAuthConfigured) {
      setStatus('signedOut');
      return () => setUnauthorizedHandler(null);
    }

    supabase.auth
      .getSession()
      .then(({ data }) => handleSession(data.session?.user.id ?? null))
      .catch(() => handleSession(null));

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      // Defer: calling supabase (via api()) inside this callback can deadlock.
      const id = session?.user.id ?? null;
      setTimeout(() => handleSession(id), 0);
    });

    return () => {
      sub.subscription.unsubscribe();
      setUnauthorizedHandler(null);
    };
  }, [loadProfile, signOut]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!isAuthConfigured) return 'The app is not configured for sign-in.';
    setNotice(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (!error) return null;
      if (error.status === 400 || /invalid login/i.test(error.message)) {
        return 'Incorrect email or password.';
      }
      return error.message || 'Sign-in failed.';
    } catch {
      return 'Cannot reach the sign-in server. Check your connection.';
    }
  }, []);

  const retryProfile = useCallback(() => {
    if (authUserId.current) void loadProfile(authUserId.current);
  }, [loadProfile]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, profile, notice, profileError, signIn, signOut, retryProfile }),
    [status, profile, notice, profileError, signIn, signOut, retryProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** For screens rendered only when signed in. */
export function useProfile(): Profile {
  const { profile } = useAuth();
  if (!profile) throw new Error('useProfile requires a signed-in user');
  return profile;
}

