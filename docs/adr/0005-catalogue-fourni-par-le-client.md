# ADR 0005 — Catalogue fourni par l'entreprise, import CSV avec mapping

Date : 2026-08-25 (décision de périmètre) · Statut : accepté

## Contexte
Les données CAN/NPK sont licenciées par CRB à chaque entreprise. Redistribuer ces données ou lire des fichiers `.crbx` supposerait une certification IfA18 (PM Informatik AG) écartée du périmètre (Q14). Toutes les entreprises du bâtiment n'utilisent pas le CAN (Q26).

## Décision
- OXACAN n'embarque aucune donnée CAN. L'entreprise importe son catalogue (CSV) et fait correspondre ses colonnes aux champs OXACAN dans un écran de mapping.
- Les codes CAN sont référencés comme des chaînes ; la structure Zone › CFC › Chapitre › Article est conservée pour rester alignée sur les usages (Q25 : ~80 % postes, ~20 % articles composés).
- Chaque entreprise crée ses propres articles composés et articles libres.

## Conséquences
- Aucune dépendance de licence côté OXACAN pour la V1.
- Le format `.crbx` reste hors périmètre (Q4) ; une lecture de soumissions PDF/Excel est prévue en remplacement.
