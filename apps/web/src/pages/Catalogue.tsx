import { useEffect, useState } from 'react';
import { api, chf } from '../lib/api';
interface Item { id: string; code: string; label: string; unit: string; chapter: string | null; material: number; labour: number; subcontract: number; }
interface Report { imported: number; skipped: number; errors: { line: number; message: string }[]; }
const SAMPLE = `Code;Désignation;Unité;Matériel;Main d'oeuvre;Chapitre\n511.211.100;Prise T13 encastrée;pce;12,50;28,00;511\n511.311.100;Interrupteur simple;pce;14,20;25,00;511`;
export default function Catalogue() {
  const [items, setItems] = useState<Item[]>([]); const [csv, setCsv] = useState(SAMPLE); const [q, setQ] = useState('');
  const [map, setMap] = useState({ code: 'Code', label: 'Désignation', unit: 'Unité', material: 'Matériel', labour: "Main d'oeuvre", subcontract: '', chapter: 'Chapitre', delimiter: ';', decimal: ',' });
  const [report, setReport] = useState<Report | null>(null); const [err, setErr] = useState('');
  const load = () => api<Item[]>(`/catalogue${q ? `?q=${encodeURIComponent(q)}` : ''}`).then(setItems);
  useEffect(() => { load(); }, [q]);
  const run = async () => { setErr(''); try { const m = Object.fromEntries(Object.entries(map).filter(([, v]) => v !== '')); setReport(await api<Report>('/catalogue/import', { method: 'POST', body: JSON.stringify({ csv, mapping: m }) })); load(); } catch (e) { setErr((e as Error).message); } };
  const headers = csv.split(/\r?\n/)[0]?.split(map.delimiter) ?? [];
  return <>
    <h1>Catalogue et articles</h1><p className="sub">Le catalogue est fourni par votre entreprise (licence CRB à votre nom) et importé par fichier CSV. OXACAN ne redistribue aucune donnée CAN.</p>
    <h2>Importer un fichier CSV</h2>
    <div className="notice">Collez le contenu du fichier, puis faites correspondre ses colonnes aux champs OXACAN. Les lignes invalides sont listées et ignorées ; les codes existants sont mis à jour.</div>
    <textarea value={csv} onChange={(e) => setCsv(e.target.value)} spellCheck={false} />
    <div className="row" style={{ marginTop: 10 }}>
      {(['code', 'label', 'unit', 'material', 'labour', 'subcontract', 'chapter'] as const).map((f) => <label key={f}>{({ code: 'Code', label: 'Désignation', unit: 'Unité', material: 'Matériel', labour: 'Main-d’œuvre', subcontract: 'Sous-traitance', chapter: 'Chapitre' })[f]}<select value={map[f]} onChange={(e) => setMap({ ...map, [f]: e.target.value })}><option value="">—</option>{headers.map((h) => <option key={h} value={h}>{h}</option>)}</select></label>)}
      <label>Séparateur<select value={map.delimiter} onChange={(e) => setMap({ ...map, delimiter: e.target.value })}><option value=";">;</option><option value=",">,</option><option value={'\t'}>tab</option></select></label>
      <label>Décimale<select value={map.decimal} onChange={(e) => setMap({ ...map, decimal: e.target.value })}><option value=",">virgule</option><option value=".">point</option></select></label>
      <button className="btn volt" onClick={run}>Importer</button>
    </div>
    {err && <p className="error">{err}</p>}
    {report && <div className="notice">{report.imported} position(s) importée(s), {report.skipped} ignorée(s).{report.errors.length > 0 && <ul>{report.errors.map((e, i) => <li key={i}>ligne {e.line} : {e.message}</li>)}</ul>}</div>}
    <h2>Positions ({items.length})</h2>
    <input placeholder="Rechercher un code ou une désignation" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 360, marginBottom: 10 }} />
    <table><thead><tr><th>Code</th><th>Désignation</th><th>Unité</th><th>Chapitre</th><th className="num">Matériel</th><th className="num">Main-d’œuvre</th><th className="num">Sous-tr.</th><th className="num">Coût unit.</th></tr></thead>
      <tbody>{items.map((i) => <tr key={i.id}><td className="code">{i.code}</td><td>{i.label}</td><td>{i.unit}</td><td>{i.chapter ?? '—'}</td><td className="num">{chf(i.material)}</td><td className="num">{chf(i.labour)}</td><td className="num">{chf(i.subcontract)}</td><td className="num">{chf(i.material + i.labour + i.subcontract)}</td></tr>)}</tbody></table>
  </>;
}
