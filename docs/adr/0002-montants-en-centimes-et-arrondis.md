# ADR 0002 — Montants en centimes entiers, arrondi 5 ct sur les totaux

Date : 2026-09-25 · Statut : accepté

## Contexte
Les flottants binaires produisent des écarts d'un centime sur des additions de lignes. Les factures suisses s'arrondissent aux 5 centimes.

## Décision
- Tous les montants sont des entiers en centimes en base, dans l'API et dans le moteur. La conversion en CHF décimal n'a lieu qu'à l'affichage.
- Arrondi commercial au centime sur chaque ligne ; arrondi aux 5 centimes uniquement sur le total TTC d'un document, avec l'écart d'arrondi exposé (`roundingAdjustment`).
- Le prix unitaire est arrondi au centime avant multiplication par la quantité (comportement standard des logiciels de chiffrage suisses).

## Conséquences
- Les quantités restent décimales (`Decimal(12,3)`).
- Le facteur de vente est un multiplicateur (coût 100 × 1.2 = 120), jamais un diviseur (Q23).
