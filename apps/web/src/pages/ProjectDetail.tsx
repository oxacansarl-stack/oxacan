import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, chf } from '../lib/api';
interface Task { id: string; title: string; status: string; hoursDone: string; lineId: string | null; line: { position: number; quantity: string; executed: string; unit: string } | null; }
interface Project { id: string; name: string; status: string; offer: { reference: string; clientName: string; vatRate: string }; lots: { id: string; zoneLabel: string; chapterCode: string; chapterLabel: string; budgetHours: string; budgetLabourCents: number; budgetMaterialCents: number; tasks: Task[] }[]; situations: { id: string; number: number; cumulativeExclVat: number; periodExclVat: number; retentionThisPeriod: number; depositsDeducted: number; netExclVat: number; netInclVat: number }[]; }
interface Dash { budgetHours: number; hoursDone: number; hoursDriftPercent: number; tasksTotal: number; tasksDone: number; progressPercent: number; }
export default function ProjectDetail() {
  const { id } = useParams(); const [p, setP] = useState<Project | null>(null); const [d, setD] = useState<Dash | null>(null); const [err, setErr] = useState(''); const [retention, setRetention] = useState(5);
  const load = () => Promise.all([api<Project>(`/projects/${id}`), api<Dash>(`/projects/${id}/dashboard`)]).then(([a, b]) => { setP(a); setD(b); }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]);
  if (err) return <div className="error">{err}</div>; if (!p || !d) return <p className="muted">Chargement…</p>;
  const patch = async (t: Task, body: object) => { await api(`/projects/tasks/${t.id}`, { method: 'PATCH', body: JSON.stringify(body) }); load(); };
  const executed = async (lineId: string, executedQuantity: number) => { setErr(''); try { await api(`/projects/${id}/executed`, { method: 'POST', body: JSON.stringify({ executed: [{ lineId, executedQuantity }] }) }); load(); } catch (e) { setErr((e as Error).message); } };
  const situation = async () => { setErr(''); try { await api(`/projects/${id}/situations`, { method: 'POST', body: JSON.stringify({ retentionPercent: retention }) }); load(); } catch (e) { setErr((e as Error).message); } };
  return <>
    <h1>{p.name}</h1><p className="sub">{p.offer.clientName} · offre <span className="code">{p.offer.reference}</span> · <span className="tag">{p.status}</span></p>
    <div className="totals">
      <div className="kpi accent"><small>Avancement</small><strong>{d.progressPercent} %</strong><small>{d.tasksDone}/{d.tasksTotal} tâches terminées</small></div>
      <div className="kpi"><small>Heures budget</small><strong>{d.budgetHours.toFixed(1)} h</strong></div>
      <div className="kpi"><small>Heures timbrées</small><strong>{d.hoursDone.toFixed(1)} h</strong></div>
      <div className="kpi" style={{ borderLeft: d.hoursDone ? `4px solid ${d.hoursDriftPercent > 0 ? 'var(--bad)' : 'var(--ok)'}` : undefined }}><small>Dérive main-d’œuvre</small><strong>{d.hoursDone ? `${d.hoursDriftPercent > 0 ? '+' : ''}${d.hoursDriftPercent} %` : '—'}</strong><small>{d.hoursDone ? 'heures timbrées vs budget' : 'aucune heure timbrée'}</small></div>
    </div>
    <h2>Lots et tâches</h2>
    <table><thead><tr><th>Lot</th><th>Tâche</th><th>Statut</th><th className="num">Heures</th><th className="num">Qté exécutée</th></tr></thead><tbody>
      {p.lots.map((l) => [<tr key={l.id} className="tree-ch"><td colSpan={3}>{l.zoneLabel} · <span className="code">CAN {l.chapterCode}</span> {l.chapterLabel}</td><td className="num">{Number(l.budgetHours).toFixed(1)} h</td><td className="muted">MO {chf(l.budgetLabourCents)} · matériel {chf(l.budgetMaterialCents)}</td></tr>,
        ...l.tasks.map((t) => <tr key={t.id}><td></td><td>{t.title}</td><td><select value={t.status} onChange={(e) => patch(t, { status: e.target.value })}><option value="A_FAIRE">À faire</option><option value="EN_COURS">En cours</option><option value="TERMINE">Terminé</option></select></td><td className="num"><input type="number" step="0.25" min="0" style={{ width: 90, textAlign: 'right' }} defaultValue={Number(t.hoursDone)} onBlur={(e) => patch(t, { hoursDone: Number(e.target.value) })} /></td><td className="num">{t.line && t.lineId && <><input type="number" step="0.001" min="0" style={{ width: 100, textAlign: 'right' }} defaultValue={Number(t.line.executed)} onBlur={(e) => executed(t.lineId!, Number(e.target.value))} /> <span className="muted">/ {Number(t.line.quantity)} {t.line.unit}</span></>}</td></tr>)])}
    </tbody></table>
    <h2>Situations de travaux</h2>
    <div className="row"><label>Retenue de garantie %<input type="number" value={retention} min={0} max={100} onChange={(e) => setRetention(Number(e.target.value))} style={{ width: 90 }} /></label><button className="btn volt" onClick={situation}>Établir la situation n°{p.situations.length + 1}</button><span className="muted">Calculée sur les quantités exécutées saisies sur les lignes de l'offre ; déduit les situations précédentes et les acomptes.</span></div>
    {err && <p className="error">{err}</p>}
    <table style={{ marginTop: 10 }}><thead><tr><th>N°</th><th className="num">Cumul HT</th><th className="num">Période HT</th><th className="num">Retenue</th><th className="num">Acomptes déduits</th><th className="num">Net HT</th><th className="num">Net TTC</th></tr></thead>
      <tbody>{p.situations.map((s) => <tr key={s.id}><td className="code">S{s.number}</td><td className="num">{chf(s.cumulativeExclVat)}</td><td className="num">{chf(s.periodExclVat)}</td><td className="num">{chf(s.retentionThisPeriod)}</td><td className="num">{chf(s.depositsDeducted)}</td><td className="num">{chf(s.netExclVat)}</td><td className="num">{chf(s.netInclVat)}</td></tr>)}{!p.situations.length && <tr><td colSpan={7} className="muted">Aucune situation établie.</td></tr>}</tbody></table>
  </>;
}
