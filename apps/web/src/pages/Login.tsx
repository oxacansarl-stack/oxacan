import React, { useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { signInWithDevToken, signInWithPassword, supabase } from '../lib/auth';
import { AuthLayout } from '@/components/auth-layout';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';

interface Props {
  notice?: string;
  onSignedIn: () => void;
}

export default function Login({ notice, onSignedIn }: Props) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [devToken, setDevToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await signInWithPassword(email, password);
      onSignedIn();
    } catch (err) {
      // Supabase answers 'Invalid login credentials' in English; show our French text instead.
      const message = err instanceof Error ? err.message : '';
      setError(/invalid login credentials/i.test(message) ? t('auth.invalidCredentials') : t('auth.signInFailed'));
    } finally {
      setBusy(false);
    }
  }

  function useDevToken() {
    if (!devToken.trim()) return;
    signInWithDevToken(devToken);
    onSignedIn();
  }

  return (
    <AuthLayout>
      <h1 className="font-display text-xl font-semibold text-ink">{t('auth:title')}</h1>

      {notice && (
        <p className="mt-4 rounded-md bg-warn-bg px-3 py-2.5 text-[13px] leading-snug text-warn">{notice}</p>
      )}

      {supabase ? (
        <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink-2">
            {t('auth.email')}
            <Input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink-2">
            {t('auth.password')}
            <Input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p role="alert" className="rounded-md bg-bad-bg px-3 py-2.5 text-[13px] leading-snug text-bad">
              {error}
            </p>
          )}
          <Button type="submit" variant="primary" disabled={busy} className="mt-1 h-10 w-full text-sm">
            {busy ? t('auth.signingIn') : t('auth.signIn')}
          </Button>
        </form>
      ) : (
        <p className="mt-6 text-[13px] text-muted">{t('auth.notConfigured')}</p>
      )}

      {import.meta.env.DEV && (
        <details className="mt-6 text-[13px] text-muted">
          <summary className="cursor-pointer select-none hover:text-ink">{t('auth.devSignIn')}</summary>
          <p className="my-2">
            <Trans
              i18nKey="auth.devSignInHelp"
              values={{ command: 'npm run db:seed -w apps/api' }}
              components={{ code: <code className="font-mono text-xs" /> }}
            />
          </p>
          <Textarea
            value={devToken}
            onChange={(e) => setDevToken(e.target.value)}
            rows={3}
            className="font-mono text-[11px]"
          />
          <Button type="button" size="sm" onClick={useDevToken} className="mt-2">
            {t('auth.useToken')}
          </Button>
        </details>
      )}
    </AuthLayout>
  );
}
