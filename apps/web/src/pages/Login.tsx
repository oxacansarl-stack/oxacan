import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, session } from '../lib/api';
export default function Login() {
  const [email, setEmail] = useState('dir@demo.oxacan.ch'); const [password, setPassword] = useState('demo12345'); const [err, setErr] = useState(''); const nav = useNavigate();
  const submit = async (e: React.FormEvent) => { e.preventDefault(); setErr('');
    try { const r = await api<{ token: string; role: string; tenantId: string; fullName: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }); session.set({ ...r, email }); nav('/offers'); } catch (x) { setErr((x as Error).message); } };
  return <div className="login"><form onSubmit={submit}><h1>OXACAN</h1><p className="muted" style={{ margin: 0 }}>De l'offre à l'encaissement.</p>
    <label>E-mail<input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></label>
    <label>Mot de passe<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
    {err && <div className="error">{err}</div>}<button className="btn volt">Se connecter</button></form></div>;
}
