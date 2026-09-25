import type { Cents } from './money.js';

/**
 * Structure d'une offre OXACAN, conforme à la hiérarchie demandée :
 *   Zone > CFC > Chapitre > Article
 * Les codes CAN sont référencés, jamais redistribués (décision de périmètre : catalogue fourni par le client).
 */

export type ArticleKind =
  /** Position issue du catalogue importé par l'entreprise (ex. CAN 511 / 574). */
  | 'catalogue'
  /** Article composé de l'entreprise, relié à un ou plusieurs postes CAN (Q25 : ~20 % des lignes). */
  | 'composed'
  /** Article libre saisi manuellement (dépannage, rénovation hors CAN). */
  | 'custom';

export interface CostBreakdown {
  /** Coût matériel unitaire, centimes. */
  material: Cents;
  /** Coût main-d'œuvre unitaire, centimes. Frais généraux intégrés au taux horaire (Q24). */
  labour: Cents;
  /** Coût sous-traitance unitaire, centimes. */
  subcontract: Cents;
}

export interface ArticleLine {
  id: string;
  kind: ArticleKind;
  /** Référence catalogue (ex. "511.211.100") ou code interne. */
  code: string;
  label: string;
  unit: string;
  quantity: number;
  cost: CostBreakdown;
  /** Facteur de vente propre à la ligne ; s'il est absent, celui de l'offre s'applique. */
  factorOverride?: number;
  /** Ligne non offerte (soumission remplie à 100 % mais poste exclu, Q36). */
  excluded?: boolean;
}

export interface Chapter { id: string; code: string; label: string; articles: ArticleLine[]; }
export interface Cfc { id: string; code: string; label: string; chapters: Chapter[]; }
export interface Zone { id: string; label: string; cfcs: Cfc[]; }

export interface OfferParams {
  /** Facteur de vente global (Q23 : coût 100 × 1.2 = prix 120). */
  sellFactor: number;
  /** Taux de TVA en %, modifiable sur le document entier (Q21). 8.1 = taux normal suisse. */
  vatRatePercent: number;
  /** Rabais global en % appliqué sur le total HT avant TVA. */
  discountPercent?: number;
  /** Arrondi du total TTC aux 5 centimes. */
  roundTotalToFiveCents?: boolean;
}

export interface Offer {
  id: string;
  reference: string;
  currency: 'CHF';
  params: OfferParams;
  zones: Zone[];
}

/** Résultat de calcul d'une ligne. */
export interface LineTotals {
  id: string;
  code: string;
  quantity: number;
  unitCost: Cents;
  unitPrice: Cents;
  totalCost: Cents;
  totalPrice: Cents;
  marginAmount: Cents;
  excluded: boolean;
}

export interface NodeTotals {
  id: string;
  label: string;
  totalCost: Cents;
  totalPrice: Cents;
  marginAmount: Cents;
  /** Marge en % du prix de vente (marge sur PV), arrondie à 2 décimales. */
  marginPercentOfPrice: number;
}

export interface OfferTotals {
  lines: LineTotals[];
  chapters: NodeTotals[];
  cfcs: NodeTotals[];
  zones: NodeTotals[];
  totalCost: Cents;
  subtotalBeforeDiscount: Cents;
  discountAmount: Cents;
  totalExclVat: Cents;
  vatAmount: Cents;
  totalInclVat: Cents;
  roundingAdjustment: Cents;
  marginAmount: Cents;
  marginPercentOfPrice: number;
}
