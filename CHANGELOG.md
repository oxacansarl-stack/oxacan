# Changelog

Toutes les dates sont réelles et correspondent à l'historique git (`git log --date=iso`).

## 2026-09-25 — Socle initial

### Moteur de chiffrage (`packages/engine`)
- Arithmétique monétaire en centimes entiers ; arrondi commercial au centime ; arrondi suisse aux 5 centimes sur les totaux.
- Calcul d'offre sur la hiérarchie Zone › CFC › Chapitre › Article : coût unitaire (matériel + main-d'œuvre + sous-traitance), facteur de vente (Q23), surcharge de facteur par ligne, lignes non offertes (Q36), rabais global, TVA modifiable sur le document (Q21), marge sur prix de vente.
- Situation de travaux sur quantités exécutées (Q28), cumul, déduction des situations précédentes et des acomptes (Q30), retenue de garantie (Q29), dépassements signalés, refus des périodes négatives (correction par avoir).
- Numérotation continue F-AAAA-NNNNN / AV- et détection des trous (Q20).
- Import de catalogue CSV avec correspondance de colonnes, séparateurs et décimales configurables, rapport d'erreurs par ligne (Option C : catalogue fourni par l'entreprise).
- Articles composés : agrégation des coûts des composants (Q25).
- Transformation offre → lots de travail avec budgets d'heures (Q34).
- 25 tests unitaires.

### API (`apps/api`)
- NestJS 10, Prisma 5, PostgreSQL 16. Multi-entreprises par `tenantId`, politiques RLS PostgreSQL sur toutes les tables métier (rôle `oxacan_app`).
- Authentification JWT ; rôles Dirigeant, Chef de projet, Technicien, Client ; garde globale.
- Modules : `auth`, `catalogue`, `offers`, `projects`, `invoices`, `health`. Validation des entrées avec Zod. Journal d'audit sur création et adjudication d'offre.
- 13 tests bout-en-bout sur base réelle : isolation entre entreprises, droits par rôle, import, article composé, offre, totaux, adjudication, tableau de bord, situation, facture, avoir, portefeuille.
- Jeu de démonstration (`prisma/seed.ts`).

### Web (`apps/web`)
- React 18 + Vite + TypeScript. Pages : connexion, offres et pipeline, détail d'offre avec arborescence et totaux, catalogue avec import CSV et mapping, chantiers, détail chantier (tâches, heures, quantités exécutées, situations), facturation et portefeuille.
- Charte : direction A « Le Nœud » des guidelines de marque (graphite, craie, cuivre, accent jaune volt, Space Grotesk).
