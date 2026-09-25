# Architecture

## Vue d'ensemble

```
┌──────────────┐    HTTPS/JSON    ┌──────────────────┐    Prisma    ┌──────────────────┐
│  apps/web    │ ───────────────▶ │  apps/api        │ ───────────▶ │  PostgreSQL 16   │
│  React+Vite  │                  │  NestJS          │              │  RLS par tenant  │
└──────────────┘                  │  ├ auth          │              └──────────────────┘
                                  │  ├ catalogue     │
                                  │  ├ offers ───────┼──▶ packages/engine (calcul pur)
                                  │  ├ projects ─────┤
                                  │  └ invoices ─────┘
                                  └──────────────────┘
```

Trois principes structurent le code.

**1. Le calcul est isolé et déterministe.** Tout ce qui produit un chiffre (prix, TVA, marge, situation, numérotation) vit dans `packages/engine`, sans base de données, sans réseau, sans date système. Même entrée, même sortie. C'est ce qui rend les règles métier testables une par une et traçables vers les réponses du client (Q20–Q36).

**2. La structure de l'offre est la structure du chantier.** L'arborescence Zone › CFC › Chapitre › Article est persistée telle quelle ; à l'adjudication, elle est projetée en lots et tâches sans copie manuelle. Les quantités exécutées sont saisies sur les lignes d'offre elles-mêmes, ce qui permet à la situation de travaux de se calculer sans ressaisie. C'est l'implémentation concrète de la « continuité numérique ».

**3. L'isolation entre entreprises est double.** L'API filtre chaque requête par `tenantId` extrait du JWT. En dessous, des politiques Row-Level Security PostgreSQL garantissent qu'une requête sans filtre ne renvoie rien d'une autre entreprise lorsque l'API se connecte avec le rôle `oxacan_app` et positionne `app.tenant_id`. Les tests bout-en-bout vérifient l'isolation au niveau applicatif ; l'activation du rôle applicatif en production est décrite dans `adr/0004`.

## Choix techniques (conformes à la proposition OXACAN DÉVELOPPEMENT §3)

| Couche | Choix | Pourquoi |
|---|---|---|
| Frontend | React 18 + TypeScript + Vite | Prévu au contrat ; typage strict ; build rapide |
| Backend | Node.js + NestJS 10 | Prévu au contrat ; modules par domaine ; injection de dépendances ; gardes |
| Base | PostgreSQL 16 + Prisma 5 | Prévu au contrat ; transactions ACID pour la numérotation et l'adjudication ; RLS natif |
| Auth | JWT signé + rôles | Prévu au contrat (Dirigeant, Chef de projet, Technicien, Client) |
| Validation | Zod | Schémas partagés lisibles, erreurs par champ |
| Tests | Vitest + Supertest | Rapides, base réelle pour l'API |
| Hébergement cible | Supabase Pro (Francfort), Railway EU West, Cloudflare | Décision d'hébergement UE, serveur principal en Suisse — voir `adr/0003` |
| IA | OpenAI / Anthropic (API) | Prévu au contrat ; aucun appel IA dans ce socle |

## Sécurité

- Mots de passe hachés (bcrypt, coût 10). Jetons JWT à durée limitée (`JWT_EXPIRES_IN`).
- Garde d'authentification globale ; routes publiques explicitement annotées (`@Public`).
- Droits par rôle sur chaque écriture (`@Roles`). Les techniciens peuvent timbrer et clore des tâches, pas créer d'offres ni de factures.
- Validation stricte des entrées ; les erreurs métier du moteur remontent en 422, jamais en 500.
- Journal d'audit (`AuditLog`) sur les événements structurants ; à étendre.
- Aucune donnée CAN/CRB dans le dépôt ni dans le seed.

## Montants et quantités

- Tous les montants sont des **entiers en centimes** en base et dans l'API. Le formatage en CHF n'a lieu qu'à l'affichage (`Intl.NumberFormat('fr-CH')`).
- Les quantités sont des `Decimal(12,3)`.
- Arrondi au centime sur les lignes, aux 5 centimes sur les totaux TTC (règle suisse d'indication des prix).

## Ce qui n'est pas encore là

Voir `ROADMAP.md`. En particulier : éditeur d'offre dans l'interface, génération PDF (offre, facture QR), application mobile terrain et mode hors-ligne, CRM, RH, stock, couche IA, analyse de PV, exports comptables.
