import { useEffect, useState } from 'react';
import { api, chf } from '../lib/api';
interface Inv { id: string; number: string; kind: string; status: string; totalExclVat: number; vatAmount: number; totalInclVat: number; issuedAt: string; dueAt: string | null; correctsId: string | null; }
interface Pf { encaisse: number; enAttente: number; echu: number; enPreparation: number; numberingGaps: number[]; }
export default function Invoices() {
  const [rows, setRows] = useState<Inv[]>([]); const [pf, setPf] = useState<Pf | null>(null); const [err, setErr] = useState('');
  const load = () => Promise.all([api<Inv[]>('/invoices'), api<Pf>('/invoices/portfolio')]).then(([a, b]) => { setRows(a); setPf(b); });
  useEffect(() => { load(); }, []);
  const act = async (path: string) => { setErr(''); try { await api(path, { method: 'POST' }); load(); } catch (e) { setErr((e as Error).message); } };
  return <><h1>Facturation</h1><p className="sub">Numérotation continue F-AAAA-NNNNN. Une facture émise ne se modifie pas : elle se corrige par un avoir (AV-).</p>
    {pf && <div className="totals"><div className="kpi accent"><small>Encaissé</small><strong>{chf(pf.encaisse)}</strong></div><div className="kpi"><small>En attente</small><strong>{chf(pf.enAttente)}</strong></div><div className="kpi" style={{ borderLeft: pf.echu ? '4px solid var(--bad)' : undefined }}><small>Échu</small><strong>{chf(pf.echu)}</strong></div><div className="kpi"><small>Continuité de numérotation</small><strong>{pf.numberingGaps.length ? `${pf.numberingGaps.length} trou(s)` : 'OK'}</strong></div></div>}
    {err && <p className="error">{err}</p>}
    <table><thead><tr><th>Numéro</th><th>Type</th><th>Statut</th><th className="num">HT</th><th className="num">TVA</th><th className="num">TTC</th><th>Émise</th><th>Échéance</th><th></th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}><td className="code">{r.number}</td><td>{r.kind}</td><td><span className={`tag ${r.status}`}>{r.status}</span></td><td className="num">{chf(r.totalExclVat)}</td><td className="num">{chf(r.vatAmount)}</td><td className="num">{chf(r.totalInclVat)}</td><td className="muted">{new Date(r.issuedAt).toLocaleDateString('fr-CH')}</td><td className="muted">{r.dueAt ? new Date(r.dueAt).toLocaleDateString('fr-CH') : '—'}</td><td className="row">{r.status === 'ENVOYEE' && r.kind !== 'AVOIR' && <><button className="btn secondary" onClick={() => act(`/invoices/${r.id}/paid`)}>Encaissée</button><button className="btn secondary" onClick={() => act(`/invoices/${r.id}/credit-note`)}>Avoir</button></>}</td></tr>)}
      {!rows.length && <tr><td colSpan={9} className="muted">Aucune facture.</td></tr>}</tbody></table></>;
}
