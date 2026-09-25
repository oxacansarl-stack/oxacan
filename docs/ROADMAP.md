# Feuille de route technique

Référence : plan de 182 tâches (Linear, projets OXACAN FR/EN) et proposition OXACAN DÉVELOPPEMENT §2. Ce fichier liste ce qui reste à construire, module par module, dans l'ordre de dépendance.

## Pilier Chiffrage / Offres
- [x] Catalogue par import CSV et mapping
- [x] Articles composés
- [x] Arborescence Zone › CFC › Chapitre › Article et totaux
- [x] Pipeline commercial
- [ ] Éditeur d'offre dans l'interface (ajout, édition, réordonnancement des lignes ; recherche catalogue)
- [ ] Versions d'offre (v1, v2…) et comparaison
- [ ] PDF d'offre (charte), envoi par e-mail (Resend)
- [ ] Import de soumission Excel/CSV vers une offre (Q27)
- [ ] Génération d'offre assistée par IA (postes suggérés depuis le type de projet)
- [ ] Import de plans PDF et extraction de métrés — sous réserve de l'évaluation sur fichiers réels demandée le 2 septembre 2026 (non reçus)

## Pilier Chantier
- [x] Adjudication → chantier, lots, tâches, budgets d'heures
- [x] Tableau de bord : avancement, heures, dérive MO
- [x] Quantités exécutées et situations de travaux
- [ ] Vues Kanban, liste, calendrier ; Gantt et dépendances
- [ ] Plus-values et bons de régie signés sur smartphone (signature simple, Q16)
- [ ] Commandes matériaux depuis les postes ; stock simple (profondeur B)
- [ ] Alertes : dérive MO, facture échue, stock critique
- [ ] PV de séance : upload PDF, extraction d'actions par IA
- [ ] Application mobile terrain (React Native) : timbrage par chantier/phase, tâches, photos, frais, note vocale ; hors-ligne « file d'attente des écritures, édition bloquée »

## Pilier Finance
- [x] Factures, acomptes, avoirs, numérotation continue, portefeuille
- [ ] PDF de facture et facture QR (QR-bill suisse)
- [ ] Relances automatiques paramétrables
- [ ] Suivi TVA collectée / déductible / à reverser, échéances AFC
- [ ] Libération de la retenue de garantie
- [ ] Factures fournisseurs : saisie, OCR avec revue obligatoire, intégration au coût chantier
- [ ] Exports comptables CSV/XLSX (format fiduciaire à confirmer) ; intégration de type Bexio (Q13)
- [ ] Vue dirigeant : CA facturé vs encaissé vs charges, résultat estimé

## Pilier CRM
- [ ] Base clients, fiche client (CA, chantiers, offres, impayés), historique des interactions
- [ ] Campagnes e-mail et suivi ; portail client en liens jetons lecture seule

## Pilier RH
- [ ] Profils, contrats, soldes ; congés et absences avec impact chantier
- [ ] Timbrages à valider ; frais et débours ; calendrier équipe
- [ ] Moteur de règles CCT configurable par l'entreprise (Q32, Q33, Q35)

## Couche IA
- [ ] Assistant chiffrage, analyse d'offre adjugée, analyse de PV, détection de dérive, analytics, CRM IA — sur API OpenAI/Anthropic, après les modules qu'elle enrichit

## Transverse
- [ ] Allemand (i18n) après le français (Q2)
- [ ] Observabilité : Sentry (UE), PostHog (UE)
- [ ] Déploiement : Supabase Pro Francfort, Railway EU West, Cloudflare ; serveur principal en Suisse
- [ ] Sauvegardes, rétention 10 ans des pièces comptables (Q22)
- [ ] Documentation utilisateur et vidéos de formation
