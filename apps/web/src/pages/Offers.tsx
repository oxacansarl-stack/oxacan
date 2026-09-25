import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
interface Row { id: string; reference: string; clientName: string; title: string; status: string; version: number; createdAt: string; }
const LABEL: Record<string, string> = { PREPARATION: 'Préparation', ENVOYEE: 'Envoyée', NEGOCIATION: 'Négociation', ADJUGEE: 'Adjugée', PERDUE: 'Perdue' };
export default function Offers() {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => { api<Row[]>('/offers').then(setRows); }, []);
  const byStatus = (s: string) => rows.filter((r) => r.status === s).length;
  return <>
    <h1>Offres et pipeline</h1><p className="sub">Chaque offre est structurée Zone › CFC › Chapitre › Article et devient le chantier à l'adjudication.</p>
    <div className="totals">{['PREPARATION', 'ENVOYEE', 'NEGOCIATION', 'ADJUGEE'].map((s) => <div key={s} className={`kpi ${s === 'ADJUGEE' ? 'accent' : ''}`}><small>{LABEL[s]}</small><strong>{byStatus(s)}</strong></div>)}</div>
    <table><thead><tr><th>Référence</th><th>Client</th><th>Objet</th><th>Statut</th><th>Créée le</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}><td><Link className="code" to={`/offers/${r.id}`}>{r.reference}</Link></td><td>{r.clientName}</td><td><Link to={`/offers/${r.id}`}>{r.title}</Link></td><td><span className={`tag ${r.status}`}>{LABEL[r.status]}</span></td><td className="muted">{new Date(r.createdAt).toLocaleDateString('fr-CH')}</td></tr>)}
      {!rows.length && <tr><td colSpan={5} className="muted">Aucune offre. Importez un catalogue puis créez une offre via l'API (l'éditeur d'offre est la prochaine itération).</td></tr>}</tbody></table>
  </>;
}
