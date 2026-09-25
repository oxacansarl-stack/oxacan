import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, chf, qty } from '../lib/api';

interface Line { id: string; kind: string; code: string; label: string; unit: string; quantity: string; material: number; labour: number; subcontract: number; excluded: boolean; }
interface Offer { id: string; reference: string; clientName: string; title: string; status: string; sellFactor: string; vatRate: string; zones: { id: string; label: string; cfcs: { id: string; code: string; label: string; chapters: { id: string; code: string; label: string; lines: Line[] }[] }[] }[]; }
interface Totals { totals: { lines: { id: string; unitPrice: number; totalPrice: number; totalCost: number }[]; chapters: { id: string; totalPrice: number }[]; zones: { id: string; totalPrice: number; marginPercentOfPrice: number }[]; totalCost: number; totalExclVat: number; vatAmount: number; totalInclVat: number; marginAmount: number; marginPercentOfPrice: number; roundingAdjustment: number } }

export default function OfferDetail() {
  const { id } = useParams(); const nav = useNavigate();
  const [o, setO] = useState<Offer | null>(null); const [t, setT] = useState<Totals['totals'] | null>(null); const [err, setErr] = useState('');
  const load = () => Promise.all([api<Offer>(`/offers/${id}`), api<Totals>(`/offers/${id}/totals`)]).then(([a, b]) => { setO(a); setT(b.totals); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]);
  if (err) return <div className="error">{err}</div>;
  if (!o || !t) return <p className="muted">Chargement…</p>;
  const L = (lid: string) => t.lines.find((x) => x.id === lid)!;
  const setStatus = async (status: string) => { try { const r = await api<{ id?: string; status?: string }>(`/offers/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }); if (status === 'ADJUGEE' && r.id) nav(`/projects/${r.id}`); else load(); } catch (e) { setErr((e as Error).message); } };
  return <>
    <div className="row"><div className="grow"><h1><span className="code">{o.reference}</span> — {o.title}</h1><p className="sub">{o.clientName} · facteur de vente {o.sellFactor} · TVA {o.vatRate} % · <span className={`tag ${o.status}`}>{o.status}</span></p></div>
      {o.status !== 'ADJUGEE' && o.status !== 'PERDUE' && <div className="row">
        <button className="btn secondary" onClick={() => setStatus('ENVOYEE')}>Marquer envoyée</button>
        <button className="btn secondary" onClick={() => setStatus('NEGOCIATION')}>En négociation</button>
        <button className="btn volt" onClick={() => setStatus('ADJUGEE')}>Adjugée → créer le chantier</button>
        <button className="btn secondary" onClick={() => setStatus('PERDUE')}>Perdue</button></div>}
    </div>
    <div className="totals">
      <div className="kpi"><small>Coût de revient</small><strong>{chf(t.totalCost)}</strong></div>
      <div className="kpi accent"><small>Total HT</small><strong>{chf(t.totalExclVat)}</strong></div>
      <div className="kpi"><small>TVA {o.vatRate} %</small><strong>{chf(t.vatAmount)}</strong></div>
      <div className="kpi"><small>Total TTC (arrondi 5 ct : {t.roundingAdjustment >= 0 ? '+' : ''}{t.roundingAdjustment} ct)</small><strong>{chf(t.totalInclVat)}</strong></div>
    </div>
    <p className="muted">Marge {chf(t.marginAmount)} · {t.marginPercentOfPrice} % du prix de vente.</p>
    <table><thead><tr><th>Poste</th><th>Désignation</th><th className="num">Qté</th><th>Unité</th><th className="num">Coût unit.</th><th className="num">Prix unit.</th><th className="num">Total HT</th></tr></thead><tbody>
      {o.zones.map((z) => { const zt = t.zones.find((x) => x.id === z.id)!; return [
        <tr key={z.id} className="tree-zone"><td colSpan={6}>{z.label}</td><td className="num">{chf(zt.totalPrice)}</td></tr>,
        ...z.cfcs.flatMap((c) => [<tr key={c.id} className="tree-cfc"><td className="code">CFC {c.code}</td><td colSpan={6}>{c.label}</td></tr>,
          ...c.chapters.flatMap((ch) => { const cht = t.chapters.find((x) => x.id === ch.id)!; return [<tr key={ch.id} className="tree-ch"><td className="code">CAN {ch.code}</td><td colSpan={5}>{ch.label}</td><td className="num">{chf(cht.totalPrice)}</td></tr>,
            ...ch.lines.map((l) => { const lt = L(l.id); const uc = l.material + l.labour + l.subcontract; return <tr key={l.id} className={`tree-line ${l.excluded ? 'excluded' : ''}`}><td className="code">{l.code}</td><td>{l.label}{l.kind === 'COMPOSED' && <span className="tag" style={{ marginLeft: 8 }}>composé</span>}{l.kind === 'CUSTOM' && <span className="tag" style={{ marginLeft: 8 }}>libre</span>}{l.excluded && <span className="tag" style={{ marginLeft: 8 }}>non offert</span>}</td><td className="num">{qty(l.quantity)}</td><td>{l.unit}</td><td className="num">{chf(uc)}</td><td className="num">{chf(lt.unitPrice)}</td><td className="num">{chf(lt.totalPrice)}</td></tr>; })]; })]) ]; })}
    </tbody></table>
  </>;
}
