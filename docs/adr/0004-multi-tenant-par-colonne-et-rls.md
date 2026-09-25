# ADR 0004 — Multi-entreprises par colonne `tenantId` + Row-Level Security

Date : 2026-09-25 · Statut : accepté

## Contexte
Plusieurs entreprises partagent une base. Une fuite entre entreprises serait une faute grave (données de prix et de marge).

## Options
1. Une base par entreprise — isolation forte, coût et migrations multipliés.
2. Un schéma par entreprise — intermédiaire, outillage Prisma limité.
3. Une colonne `tenantId` + RLS PostgreSQL — isolation en profondeur, une seule migration, compatible Supabase.

## Décision
Option 3. L'API filtre chaque requête par `tenantId` (jeton JWT). Une migration active RLS sur toutes les tables métier avec une politique `tenant_isolation` pour le rôle `oxacan_app`, qui lit `app.tenant_id`.

## Mise en production
- L'API se connecte avec `oxacan_app` (pas le superutilisateur) et exécute `SET LOCAL app.tenant_id = '<id>'` au début de chaque transaction (helper à ajouter dans `PrismaService` lors du déploiement).
- Les tests bout-en-bout vérifient déjà l'isolation applicative (une entreprise ne voit ni les offres ni le catalogue d'une autre).
