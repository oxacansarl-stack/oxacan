import { describe, it, expect } from 'vitest';
import { importCatalogue, parseCsv, composeCosts } from '../src/index.js';

const csv = `Code;Désignation;Unité;Matériel;Main d'oeuvre;Chapitre
511.211.100;Prise T13 encastrée;pce;12,50;28,00;511
511.211.110;"Prise T13, double";pce;18,90;30,00;511
;Ligne sans code;pce;1,00;1,00;511
511.211.100;Doublon;pce;1,00;1,00;511
574.100.200;Tableau;pce;abc;10,00;574
`;

describe('catalogue CSV import with mapping (Option C)', () => {
  it('parses quoted fields and CRLF', () => {
    expect(parseCsv('a;"b;c";d\r\n1;2;3\n', ';')).toEqual([['a', 'b;c', 'd'], ['1', '2', '3']]);
  });
  it('maps client columns to the internal model and converts to cents', () => {
    const r = importCatalogue(csv, { code: 'Code', label: 'Désignation', unit: 'Unité', material: 'Matériel', labour: "Main d'oeuvre", chapter: 'Chapitre', delimiter: ';', decimal: ',' });
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ code: '511.211.100', material: 1250, labour: 2800, chapter: '511' });
    expect(r.rows[1]?.label).toBe('Prise T13, double');
    expect(r.errors.map((e) => e.message)).toEqual(['missing code', 'duplicate code 511.211.100', 'non-numeric price']);
    expect(r.skipped).toBe(3);
  });
  it('fails clearly when a mapped column does not exist', () => {
    const r = importCatalogue(csv, { code: 'Ref', label: 'Désignation', unit: 'Unité', delimiter: ';' });
    expect(r.rows).toHaveLength(0);
    expect(r.errors[0]?.message).toMatch(/mapped column not found: code/);
  });
  it('Q25: composed article aggregates its CAN components', () => {
    expect(composeCosts([{ code: 'a', quantity: 2, material: 1000, labour: 500, subcontract: 0 }, { code: 'b', quantity: 1.5, material: 200, labour: 100, subcontract: 0 }])).toEqual({ material: 2300, labour: 1150, subcontract: 0 });
  });
});
