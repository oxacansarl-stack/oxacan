import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { setPassword } from '../lib/auth';

const MIN_LENGTH = 10;

const input: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 14,
  boxSizing: 'border-box',
};
const label: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 };

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
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f8f9fa',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        padding: 16,
      }}
    >
      <form
        onSubmit={submit}
        style={{ width: '100%', maxWidth: 380, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 28 }}
      >
        <div style={{ fontSize: 22, fontWeight: 800, color: '#111827', letterSpacing: -0.5 }}>OXACAN</div>
        <h1 style={{ fontSize: 16, fontWeight: 700, color: '#111827', margin: '16px 0 4px' }}>{t('auth.setPasswordTitle')}</h1>
        <p style={{ fontSize: 13, color: '#6b7280', margin: '0 0 20px' }}>{t('auth.setPasswordHelp')}</p>

        <label style={label}>{t('auth.newPassword')}</label>
        <input
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_LENGTH}
          value={password}
          onChange={(e) => setPw(e.target.value)}
          style={{ ...input, marginBottom: 14 }}
        />
        <label style={label}>{t('auth.confirmPassword')}</label>
        <input
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          style={{ ...input, marginBottom: 18 }}
        />
        {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}
        <button
          type="submit"
          disabled={busy}
          style={{
            width: '100%',
            padding: '10px 12px',
            background: busy ? '#93c5fd' : '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 600,
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          {busy ? t('auth.saving') : t('auth.savePassword')}
        </button>
      </form>
    </div>
  );
}
