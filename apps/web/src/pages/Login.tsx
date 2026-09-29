import React, { useState } from 'react';
import { signInWithDevToken, signInWithPassword, supabase } from '../lib/auth';

interface Props {
  notice?: string;
  onSignedIn: () => void;
}

const input: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  border: '1px solid #d1d5db',
  borderRadius: 6,
  fontSize: 14,
  boxSizing: 'border-box',
};

export default function Login({ notice, onSignedIn }: Props) {
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
      setError(err instanceof Error ? err.message : 'Sign-in failed');
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
      <div
        style={{
          width: '100%',
          maxWidth: 380,
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 10,
          padding: 28,
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 800, color: '#111827', letterSpacing: -0.5 }}>OXACAN</div>
        <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 24 }}>Swiss Construction ERP</div>

        {notice && (
          <div style={{ background: '#fef3c7', color: '#92400e', padding: 10, borderRadius: 6, fontSize: 13, marginBottom: 16 }}>
            {notice}
          </div>
        )}

        {supabase ? (
          <form onSubmit={submit}>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
              Email
            </label>
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ ...input, marginBottom: 14 }}
            />
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }}>
              Password
            </label>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
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
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        ) : (
          <div style={{ fontSize: 13, color: '#6b7280' }}>
            Sign-in is not configured: set SUPABASE_URL and SUPABASE_ANON_KEY in the root .env.
          </div>
        )}

        {import.meta.env.DEV && (
          <details style={{ marginTop: 20, fontSize: 13, color: '#6b7280' }}>
            <summary style={{ cursor: 'pointer' }}>Developer sign-in</summary>
            <p style={{ margin: '8px 0' }}>
              Paste a token printed by <code>npm run db:seed -w apps/api</code>.
            </p>
            <textarea
              value={devToken}
              onChange={(e) => setDevToken(e.target.value)}
              rows={3}
              style={{ ...input, fontFamily: 'monospace', fontSize: 11 }}
            />
            <button
              type="button"
              onClick={useDevToken}
              style={{
                marginTop: 8,
                padding: '6px 12px',
                background: '#fff',
                border: '1px solid #d1d5db',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              Use token
            </button>
          </details>
        )}
      </div>
    </div>
  );
}
