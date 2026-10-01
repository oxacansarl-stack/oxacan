import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { setPassword } from '../lib/auth';
import { AuthLayout } from '@/components/auth-layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const MIN_LENGTH = 10;

/** Shown after an invite or password-reset link signed the person in, before they enter the app. */
export default function SetPassword({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [password, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < MIN_LENGTH) return setError(t('auth.passwordTooShort', { min: MIN_LENGTH }));
    if (password !== confirm) return setError(t('auth.passwordsDontMatch'));
    setError('');
    setBusy(true);
    try {
      await setPassword(password);
      onDone();
    } catch {
      setError(t('auth.setPasswordFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <h1 className="font-display text-xl font-semibold text-ink">{t('auth.setPasswordTitle')}</h1>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">{t('auth.setPasswordHelp')}</p>

      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink-2">
          {t('auth.newPassword')}
          <Input
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_LENGTH}
            value={password}
            onChange={(e) => setPw(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink-2">
          {t('auth.confirmPassword')}
          <Input
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="rounded-md bg-bad-bg px-3 py-2.5 text-[13px] leading-snug text-bad">
            {error}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={busy} className="mt-1 h-10 w-full text-sm">
          {busy ? t('auth.saving') : t('auth.savePassword')}
        </Button>
      </form>
    </AuthLayout>
  );
}
