# ADR 0003 — Hébergement UE, serveur principal en Suisse

Date : 2026-08-25 (décision de périmètre), consigné le 2026-09-25 · Statut : accepté

## Contexte
Le document de vision évoquait un hébergement souverain suisse. Le client a précisé que seul le serveur principal doit résider en Suisse ; les services annexes peuvent être hébergés dans l'UE.

## Décision
- Base, authentification et stockage : Supabase Pro, région Francfort (eu-central-1).
- Exécution de l'API : Railway EU West. Réseau et DNS : Cloudflare.
- Observabilité : Sentry (région UE), PostHog EU Cloud. E-mails : Resend.
- IA : API OpenAI ou Anthropic. Aucun traitement IA n'est encore présent dans le socle.
- Le serveur principal (point d'entrée) est déployé en Suisse.

## Conséquences
- Coût mensuel et capacité nettement plus favorables qu'une pile 100 % suisse.
- Les comptes sont ouverts au nom d'OXACAN (voir fiche d'approvisionnement du 25 août 2026).
