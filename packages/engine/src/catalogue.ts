/**
 * Import de catalogue par fichier CSV avec écran de correspondance (mapping).
 * Décision de périmètre : l'entreprise fournit son propre catalogue (licence CRB à sa charge) ;
 * OXACAN ne redistribue aucune donnée CAN. Le mapping traduit les colonnes du fichier client
 * vers le modèle interne.
 */
import { chfToCents } from './money.js';

export interface CatalogueMapping {
  code: string; label: string; unit: string;
  material?: string; labour?: string; subcontract?: string; unitPrice?: string;
  chapter?: string; delimiter?: ',' | ';' | '\t';
  /** Séparateur décimal du fichier source ("." ou ","). */
  decimal?: '.' | ',';
}

export interface CatalogueRow { code: string; label: string; unit: string; material: number; labour: number; subcontract: number; chapter?: string; }

export interface ImportReport { rows: CatalogueRow[]; errors: { line: number; message: string }[]; skipped: number; }

export function parseCsv(text: string, delimiter: ',' | ';' | '\t' = ';'): string[][] {
  const out: string[][] = [];
  let row: string[] = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(field); out.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); out.push(row); }
  return out.filter((r) => r.some((c) => c.trim() !== ''));
}

function num(raw: string | undefined, decimal: '.' | ','): number | null {
  if (raw === undefined) return 0;
  const s = raw.trim().replace(/['\s]/g, '');
  if (s === '') return 0;
  const normalized = decimal === ',' ? s.replace('.', '').replace(',', '.') : s.replace(',', '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Applique le mapping à un CSV et retourne lignes valides + erreurs par ligne. Les prix sont convertis en centimes. */
export function importCatalogue(csvText: string, mapping: CatalogueMapping): ImportReport {
  const table = parseCsv(csvText, mapping.delimiter ?? ';');
  const header = table[0];
  if (!header) return { rows: [], errors: [{ line: 1, message: 'empty file' }], skipped: 0 };
  const idx = (name: string | undefined) => (name ? header.findIndex((h) => h.trim().toLowerCase() === name.trim().toLowerCase()) : -1);
  const iCode = idx(mapping.code), iLabel = idx(mapping.label), iUnit = idx(mapping.unit);
  const errors: ImportReport['errors'] = [];
  for (const [name, i] of [['code', iCode], ['label', iLabel], ['unit', iUnit]] as const) if (i < 0) errors.push({ line: 1, message: `mapped column not found: ${name}` });
  if (errors.length) return { rows: [], errors, skipped: table.length - 1 };
  const iMat = idx(mapping.material), iLab = idx(mapping.labour), iSub = idx(mapping.subcontract), iUP = idx(mapping.unitPrice), iCh = idx(mapping.chapter);
  const decimal = mapping.decimal ?? '.';
  const rows: CatalogueRow[] = []; const seen = new Set<string>(); let skipped = 0;
  for (let r = 1; r < table.length; r++) {
    const line = table[r]!; const lineNo = r + 1;
    const code = (line[iCode] ?? '').trim();
    if (!code) { errors.push({ line: lineNo, message: 'missing code' }); skipped++; continue; }
    if (seen.has(code)) { errors.push({ line: lineNo, message: `duplicate code ${code}` }); skipped++; continue; }
    const material = iMat >= 0 ? num(line[iMat], decimal) : 0;
    const labour = iLab >= 0 ? num(line[iLab], decimal) : 0;
    const subcontract = iSub >= 0 ? num(line[iSub], decimal) : 0;
    const unitPrice = iUP >= 0 ? num(line[iUP], decimal) : 0;
    if ([material, labour, subcontract, unitPrice].some((v) => v === null)) { errors.push({ line: lineNo, message: 'non-numeric price' }); skipped++; continue; }
    // Si seul un prix unitaire global est fourni, il est porté en matériel (à ventiler ensuite par l'entreprise).
    const mat = (material as number) || (unitPrice as number);
    seen.add(code);
    rows.push({ code, label: (line[iLabel] ?? '').trim(), unit: (line[iUnit] ?? '').trim() || 'pce', material: chfToCents(mat), labour: chfToCents(labour as number), subcontract: chfToCents(subcontract as number), ...(iCh >= 0 && line[iCh] ? { chapter: line[iCh]!.trim() } : {}) });
  }
  return { rows, errors, skipped };
}

/** Article composé : agrège les coûts de ses composants (postes CAN × quantité) — Q25. */
export interface ComposedComponent { code: string; quantity: number; material: number; labour: number; subcontract: number; }
export function composeCosts(components: ComposedComponent[]): { material: number; labour: number; subcontract: number } {
  return components.reduce((acc, c) => ({ material: acc.material + Math.round(c.material * c.quantity), labour: acc.labour + Math.round(c.labour * c.quantity), subcontract: acc.subcontract + Math.round(c.subcontract * c.quantity) }), { material: 0, labour: 0, subcontract: 0 });
}
