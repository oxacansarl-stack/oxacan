# ADR 0006 — Continuité numérique : l'offre est le chantier, le chantier est la situation

Date : 2026-09-25 · Statut : accepté

## Contexte
La thèse produit est l'absence de ressaisie entre phases. Le client décrit la transformation d'une offre en tâches par regroupement des postes en lots (Q34) et le calcul des situations sur quantités réellement exécutées (Q28).

## Décision
- L'adjudication est la seule façon de créer un chantier. Elle projette l'arborescence en `WorkLot` (zone × chapitre) et `Task` (une par ligne non exclue), avec budgets d'heures dérivés du coût main-d'œuvre et du taux horaire de l'entreprise.
- Les quantités exécutées sont portées par les lignes d'offre (`OfferLine.executed`) ; la situation n° N se calcule depuis ces lignes, déduit les situations 1..N-1 et les acomptes facturés, applique la retenue.
- Une situation sans période positive est refusée ; une correction passe par un avoir.

## Conséquences
- Aucune copie de structure entre modules ; une modification de périmètre passe par une plus-value (à venir), pas par une édition libre du chantier.
- Les tests `flow.e2e.test.ts` parcourent la chaîne complète.
