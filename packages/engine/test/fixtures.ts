import type { Offer } from '../src/index.js';

/** Offre de référence : rénovation, 2 zones, chiffres choisis pour être vérifiables à la main. */
export function sampleOffer(): Offer {
  return {
    id: 'off-1', reference: 'O-2026-00001', currency: 'CHF',
    params: { sellFactor: 1.2, vatRatePercent: 8.1, roundTotalToFiveCents: true },
    zones: [
      { id: 'z1', label: 'Rez-de-chaussée', cfcs: [
        { id: 'c1', code: '232', label: 'Installations à courant fort', chapters: [
          { id: 'ch1', code: '511', label: 'Installations électriques', articles: [
            // coût unitaire 50.00 = 20 mat + 30 MO → prix 60.00 ; 10 pces → 600.00
            { id: 'a1', kind: 'catalogue', code: '511.211.100', label: 'Prise T13 encastrée', unit: 'pce', quantity: 10, cost: { material: 2000, labour: 3000, subcontract: 0 } },
            // coût 100.00 → prix 120.00 ; 4 pces → 480.00
            { id: 'a2', kind: 'composed', code: 'ART-PL-01', label: 'Point lumineux complet', unit: 'pce', quantity: 4, cost: { material: 4000, labour: 6000, subcontract: 0 } },
          ] },
        ] },
      ] },
      { id: 'z2', label: 'Étage', cfcs: [
        { id: 'c2', code: '232', label: 'Installations à courant fort', chapters: [
          { id: 'ch2', code: '574', label: 'Tableaux', articles: [
            // sous-traitance 800.00 → prix 960.00 ; 1 pce
            { id: 'a3', kind: 'custom', code: 'TAB-01', label: 'Tableau divisionnaire', unit: 'pce', quantity: 1, cost: { material: 0, labour: 0, subcontract: 80000 } },
            // ligne exclue : ne compte pas
            { id: 'a4', kind: 'catalogue', code: '574.100.200', label: 'Option non offerte', unit: 'pce', quantity: 3, cost: { material: 1000, labour: 1000, subcontract: 0 }, excluded: true },
          ] },
        ] },
      ] },
    ],
  };
}
