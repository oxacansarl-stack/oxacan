# ADR 0001 — Monorepo npm et moteur de calcul isolé

Date : 2026-09-25 · Statut : accepté

## Contexte
Le produit produit des chiffres qui engagent l'entreprise cliente (offres, situations, factures). Les règles (facteur 1.2, TVA modifiable, retenue, acomptes, numérotation) viennent des réponses du client et doivent être vérifiables une par une.

## Décision
- Un monorepo npm workspaces avec trois paquets : `packages/engine`, `apps/api`, `apps/web`.
- Toute logique de calcul vit dans `packages/engine`, en TypeScript pur, sans I/O ni date système. L'API et le web l'appellent ; ils ne recalculent jamais.
- Chaque règle métier a un test qui cite la question client (Qn).

## Conséquences
- Les règles sont testables en millisecondes et auditables sans base de données.
- Une future application mobile (React Native) réutilise le même moteur.
- Le moteur est construit (`npm run build -w packages/engine`) avant l'API.
