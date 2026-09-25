# Modèle de données

Source de vérité : `apps/api/prisma/schema.prisma`. Ce document explique les intentions.

## Entreprises et utilisateurs
- `Tenant` — une entreprise cliente d'OXACAN. Porte ses paramètres : facteur de vente par défaut (1.2), taux horaire (centimes) servant aux budgets d'heures, taux de TVA (8.1).
- `User` — appartient à un tenant ; rôle parmi `DIRIGEANT`, `CHEF_PROJET`, `TECHNICIEN`, `CLIENT`. Unicité de l'e-mail par tenant.

## Catalogue
- `CatalogueItem` — position importée par l'entreprise (code, désignation, unité, chapitre, coûts matériel / main-d'œuvre / sous-traitance en centimes). Unicité `(tenantId, code)`. Réimporter un code met la position à jour.
- `ComposedArticle` + `ComposedComponent` — article propre à l'entreprise, défini comme une liste de codes catalogue × quantité. Son coût est agrégé à la demande, donc toujours aligné sur le catalogue courant.

## Offres
- `Offer` — référence continue `O-AAAA-NNNNN`, client, objet, statut de pipeline (`PREPARATION → ENVOYEE → NEGOCIATION → ADJUGEE | PERDUE`), paramètres figés à la création (facteur, TVA, rabais).
- `Zone › Cfc › Chapter › OfferLine` — l'arborescence. Chaque ligne fige ses coûts unitaires au moment de la création (une variation ultérieure du catalogue ne modifie pas une offre existante). `excluded` marque un poste non offert ; `executed` porte la quantité exécutée cumulée pour les situations.

## Chantiers
- `Project` — créé uniquement par adjudication d'une offre (relation 1–1).
- `WorkLot` — regroupement des lignes par zone et chapitre, avec budgets main-d'œuvre, matériel et heures.
- `Task` — une par ligne non exclue ; statut et heures timbrées.

## Facturation
- `Situation` — état d'avancement n° N d'un chantier ; montants calculés et figés, instantané complet en JSON.
- `Invoice` — numérotation continue par tenant et par année via `DocumentSequence` (transaction). Types : acompte, situation, finale, one-shot, avoir. Un avoir référence la facture qu'il corrige (`correctsId`) ; la facture corrigée passe en `ANNULEE`.

## Invariants garantis en base
- Unicité des références et numéros par tenant.
- Un chantier par offre ; une facture par situation.
- Suppression en cascade tenant → toutes ses données.
- RLS activé sur toutes les tables métier (politique `tenant_isolation`).
