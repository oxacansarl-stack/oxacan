import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
interface Row { id: string; name: string; status: string; createdAt: string; offer: { reference: string; clientName: string }; _count: { lots: number; situations: number } }
export default function Projects() {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => { api<Row[]>('/projects').then(setRows); }, []);
  return <><h1>Chantiers</h1><p className="sub">Créés automatiquement à l'adjudication : lots, tâches et budgets d'heures viennent de l'offre.</p>
    <table><thead><tr><th>Chantier</th><th>Offre</th><th>Client</th><th>Statut</th><th className="num">Lots</th><th className="num">Situations</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}><td><Link to={`/projects/${r.id}`}>{r.name}</Link></td><td className="code">{r.offer.reference}</td><td>{r.offer.clientName}</td><td><span className="tag">{r.status}</span></td><td className="num">{r._count.lots}</td><td className="num">{r._count.situations}</td></tr>)}
      {!rows.length && <tr><td colSpan={6} className="muted">Aucun chantier. Adjugez une offre pour en créer un.</td></tr>}</tbody></table></>;
}
