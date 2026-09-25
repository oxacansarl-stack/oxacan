# API

Préfixe `/api`. Authentification par en-tête `Authorization: Bearer <jwt>` sauf mention *public*. Montants en centimes.

| Méthode | Route | Rôles | Description |
|---|---|---|---|
| GET | `/health` | public | État de l'API et de la base |
| POST | `/auth/bootstrap` | public | Crée une entreprise et son premier Dirigeant |
| POST | `/auth/login` | public | Retourne un jeton |
| POST | `/auth/users` | Dirigeant | Ajoute un utilisateur avec un rôle |
| GET | `/auth/me` | tous | Identité courante |
| POST | `/catalogue/import` | Dirigeant, Chef de projet | Import CSV `{ csv, mapping }` ; rapport `{ imported, skipped, errors[] }` |
| GET | `/catalogue?q=&chapter=` | tous | Positions de l'entreprise |
| POST | `/catalogue/composed` | Dirigeant, Chef de projet | Article composé |
| GET | `/catalogue/composed/:id/cost` | tous | Coût agrégé d'un article composé |
| POST | `/offers` | Dirigeant, Chef de projet | Offre complète (arborescence). Lignes `CATALOGUE` résolues depuis le catalogue, `COMPOSED` depuis les composants, `CUSTOM` avec coûts fournis |
| GET | `/offers` | tous | Liste |
| GET | `/offers/:id` | tous | Arborescence |
| GET | `/offers/:id/totals` | tous | Totaux calculés par le moteur |
| PATCH | `/offers/:id/status` | Dirigeant, Chef de projet | Pipeline ; `ADJUGEE` crée le chantier et retourne le projet |
| GET | `/projects` · `/projects/:id` · `/projects/:id/dashboard` | tous | Chantiers |
| PATCH | `/projects/tasks/:taskId` | Dirigeant, Chef de projet, Technicien | Statut et heures timbrées |
| POST | `/projects/:id/executed` | Dirigeant, Chef de projet | Quantités exécutées cumulées par ligne |
| POST | `/projects/:id/situations` | Dirigeant, Chef de projet | Situation n° suivante `{ retentionPercent }` |
| GET | `/invoices` · `/invoices/portfolio` | tous | Factures ; portefeuille encaissé / en attente / échu + contrôle de numérotation |
| POST | `/invoices` | Dirigeant, Chef de projet | Acompte, one-shot ou finale |
| POST | `/invoices/from-situation` | Dirigeant, Chef de projet | Facture depuis une situation |
| POST | `/invoices/:id/credit-note` | Dirigeant | Avoir |
| POST | `/invoices/:id/paid` | Dirigeant, Chef de projet | Marque encaissée |

## Exemple : importer un catalogue

```bash
curl -X POST localhost:3000/api/catalogue/import -H "Authorization: Bearer $T" -H 'content-type: application/json' -d '{
  "csv": "Code;Désignation;Unité;Matériel;Main d'"'"'oeuvre;Chapitre\n511.211.100;Prise T13;pce;12,50;28,00;511",
  "mapping": { "code": "Code", "label": "Désignation", "unit": "Unité", "material": "Matériel", "labour": "Main d'"'"'oeuvre", "chapter": "Chapitre", "delimiter": ";", "decimal": "," }
}'
```

## Exemple : créer une offre

```json
{ "clientName": "Régie du Lac", "title": "Rénovation — lot électricité",
  "zones": [{ "label": "Rez", "cfcs": [{ "code": "232", "label": "Courant fort", "chapters": [{ "code": "511", "label": "Installations électriques", "lines": [
    { "kind": "CATALOGUE", "code": "511.211.100", "quantity": 10 },
    { "kind": "CUSTOM", "code": "TAB-01", "label": "Tableau (sous-traité)", "unit": "pce", "quantity": 1, "subcontract": 80000 } ] }] }] }] }
```

Le fichier `apps/api/test/flow.e2e.test.ts` est une spécification exécutable de l'ensemble du parcours.
