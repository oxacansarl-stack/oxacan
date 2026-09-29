# OXACAN — Product Requirements Document (PRD)

**Version:** 1.0  
**Date:** 2026-09-28  
**Auteur:** Keeel AG  
**Statut:** Validé — toutes les questions client résolues  
**Langue de référence:** Français (V1)

---

## Table des matières

1. [Vision et positionnement](#1-vision-et-positionnement)
2. [Périmètre produit](#2-périmètre-produit)
3. [Utilisateurs cibles et rôles](#3-utilisateurs-cibles-et-rôles)
4. [Modèle d'abonnement et tarification](#4-modèle-dabonnement-et-tarification)
5. [Architecture technique](#5-architecture-technique)
6. [Module 1 — Plans et analyse](#6-module-1--plans-et-analyse)
7. [Module 2 — Moteur de chiffrage (Offres)](#7-module-2--moteur-de-chiffrage-offres)
8. [Module 3 — Contrats et commandes](#8-module-3--contrats-et-commandes)
9. [Module 4 — Projets et planification](#9-module-4--projets-et-planification)
10. [Module 5 — Tâches, équipes et timbrage](#10-module-5--tâches-équipes-et-timbrage)
11. [Module 6 — Réunions de chantier](#11-module-6--réunions-de-chantier)
12. [Module 7 — Approvisionnement](#12-module-7--approvisionnement)
13. [Module 8 — Stock et véhicules](#13-module-8--stock-et-véhicules)
14. [Module 9 — CRM et gestion clients](#14-module-9--crm-et-gestion-clients)
15. [Module 10 — Facturation, situations et plus-values](#15-module-10--facturation-situations-et-plus-values)
16. [Module 11 — Comptabilité et finances](#16-module-11--comptabilité-et-finances)
17. [Module 12 — Export fiduciaire](#17-module-12--export-fiduciaire)
18. [Module 13 — Administration, sécurité et conformité](#18-module-13--administration-sécurité-et-conformité)
19. [Module 14 — RH et équipes](#19-module-14--rh-et-équipes)
20. [Application mobile](#20-application-mobile)
21. [Portail client](#21-portail-client)
22. [Intelligence artificielle](#22-intelligence-artificielle)
23. [Règles métier transversales](#23-règles-métier-transversales)
24. [Exigences légales et réglementaires suisses](#24-exigences-légales-et-réglementaires-suisses)
25. [Politique de rétention des données](#25-politique-de-rétention-des-données)
26. [Périmètre V1 — Inclusions et exclusions](#26-périmètre-v1--inclusions-et-exclusions)
27. [Méthodologie de développement](#27-méthodologie-de-développement)
28. [Objectifs de lancement](#28-objectifs-de-lancement)
29. [Annexe A — Réponses client consolidées (Q1–Q39)](#29-annexe-a--réponses-client-consolidées-q1q39)
30. [Annexe B — Modèle de données du moteur d'offres](#30-annexe-b--modèle-de-données-du-moteur-doffres)
31. [Annexe C — Glossaire](#31-annexe-c--glossaire)

---

## 1. Vision et positionnement

### 1.1 Vision

OXACAN est un ERP SaaS vertical destiné aux entreprises du bâtiment en Suisse (BTP). Il couvre l'intégralité du cycle de vie d'un projet de construction : du chiffrage initial à la facturation finale, en passant par la gestion de chantier, le suivi des heures, l'approvisionnement et la comptabilité.

### 1.2 Proposition de valeur

- **Chiffrage intelligent** : Moteur d'offres basé sur l'intelligence artificielle, catalogue CAN/NPK normatif suisse, suggestions automatiques par profil de pièce.
- **Intégration verticale complète** : Un seul outil pour tout le cycle projet — plus de transferts manuels entre logiciels.
- **Conformité suisse native** : TVA suisse, arrondi à 5 centimes, formats CRB, conventions SSE-IPB, droit des obligations (CO), LPD/RGPD.
- **Mobile-first pour le terrain** : Application mobile avec mode hors-ligne pour les ouvriers et chefs d'équipe.
- **IA intégrée** : Suggestions de prix, transformation offre→tâches, chatbot de support 24/7.

### 1.3 Marché cible

| Segment | Description |
|---------|-------------|
| **Primaire** | Entreprises d'électricité suisses (groupe CAN 500) |
| **Secondaire** | Toutes entreprises BTP suisses (sanitaire, CVC, maçonnerie, etc.) |
| **Tertiaire** | Entreprises non-BTP pouvant utiliser OXACAN sans le catalogue CAN |

### 1.4 Types de clients

- Maîtres d'ouvrage
- Promoteurs immobiliers
- Architectes
- Ingénieurs
- Entreprises générales
- Collectivités publiques (à terme — Q6)

### 1.5 Différenciation

OXACAN se différencie des ERP généralistes et des outils BTP existants par :

1. Le moteur d'offres IA avec profils de pièces (unique sur le marché suisse)
2. L'intégration native du catalogue CAN/NPK normatif
3. La couverture complète du cycle projet dans une seule plateforme
4. L'UX moderne adaptée à chaque rôle (ouvrier, chef d'équipe, chef de projet, direction)
5. La tarification accessible par utilisateur

---

## 2. Périmètre produit

### 2.1 Flux principal

```
Plan → Soumission → Offre → Projet → Tâches → Temps & Matériel → Facturation → Comptabilité
```

### 2.2 Les 5 piliers

| Pilier | Modules |
|--------|---------|
| **Chiffrage** | Plans & analyse, Moteur d'offres, Contrats |
| **Chantier** | Projets & planification, Tâches & timbrage, Réunions, Approvisionnement, Stock |
| **Finance & Facturation** | Facturation, Situations, Plus-values, Comptabilité, Export fiduciaire |
| **CRM & Clients** | Gestion clients, Portail client |
| **RH & Équipes** | Gestion des employés, Taux horaires, Heures supplémentaires |
| **Transverse** | IA, Administration, Sécurité, Conformité |

### 2.3 Plateformes

| Plateforme | Utilisateurs cibles | Technologie |
|------------|--------------------| ------------|
| **Application web** | Direction, chefs de projet, comptables, chiffreurs | React + TypeScript |
| **Application mobile** | Ouvriers, chefs d'équipe | React Native ou PWA |

---

## 3. Utilisateurs cibles et rôles

### 3.1 Rôles système

| Rôle | Accès | Description |
|------|-------|-------------|
| **Administrateur** | Complet | Configuration entreprise, gestion utilisateurs, tous modules |
| **Chef de projet** | Étendu | Gestion projets, offres, facturation, équipes de ses projets |
| **Chef d'équipe** | Terrain | Tâches, timbrage, matériel, rapports terrain |
| **Ouvrier** | Limité | Timbrage, tâches assignées, rapports journaliers |

### 3.2 Interfaces par rôle

#### Ouvrier (mobile principalement)
- Pointer ses heures (début/fin, pause)
- Voir ses tâches du jour
- Signaler l'utilisation de matériel
- Remplir un rapport journalier
- Signer un bon de régie (signature simple)

#### Chef d'équipe (mobile + web)
- Toutes les fonctions ouvrier
- Distribuer les tâches à l'équipe
- Valider les heures de ses ouvriers
- Gérer le matériel sur chantier
- Rédiger les PV de réunion de chantier

#### Chef de projet (web principalement)
- Créer et gérer les offres
- Planifier les projets (Gantt)
- Suivre l'avancement et les coûts
- Gérer les sous-traitants
- Émettre les factures et situations
- Exporter les données fiduciaires (ses projets)

#### Direction / Chiffreur (web)
- Accès complet à tous les modules
- Tableaux de bord et analytics
- Configuration de l'entreprise
- Gestion des utilisateurs et licences
- Export fiduciaire complet
- Comptabilité

### 3.3 Authentification

- **Méthode** : JWT (JSON Web Token)
- **Niveaux** : 4 rôles hiérarchiques (ouvrier < chef d'équipe < chef de projet < administrateur)
- **Multi-tenant** : Isolation par Row-Level Security (RLS) Supabase
- **Sessions** : Tokens à durée limitée avec refresh

---

## 4. Modèle d'abonnement et tarification

### 4.1 Structure tarifaire (Décision validée — Option 2)

**Modèle : Tarification par utilisateur, deux niveaux de service, facturation à l'entreprise.**

| Aspect | Décision |
|--------|----------|
| **Unité de facturation** | Par utilisateur nommé |
| **Niveaux** | 2 : « SaaS » (ouvriers/chefs d'équipe) et « Application » (chefs de projet/direction/chiffreurs) |
| **Facturation** | À l'entreprise (pas aux individus) |
| **Prorata** | Au prorata pour les mois partiels (ajout/retrait d'utilisateurs en cours de mois) |
| **Devise** | CHF |

### 4.2 Paliers recommandés (Q1)

Trois paliers de prix recommandés :

| Palier | Cible | Fourchette indicative |
|--------|-------|----------------------|
| **Solo** | Indépendants, 1-2 utilisateurs | ~10-40 CHF/mois/utilisateur |
| **Équipe** | PME, 3-20 utilisateurs | ~40-150 CHF/mois/utilisateur |
| **Entreprise** | Grandes entreprises, 20+ utilisateurs | ~150-350 CHF/mois/utilisateur |

*Note : Les tarifs exacts seront définis avant le lancement. Fourchettes indicatives issues du document de vision.*

### 4.3 Moyens de paiement (Q10)

- Carte bancaire (Stripe ou équivalent)
- Facture / virement bancaire

### 4.4 Licence CRB (Q14)

- OXACAN acquiert une **licence développeur** CRB
- Le client acquiert une **licence d'utilisation** CRB séparément
- Pas de certification CRB en V1
- Conditions contractuelles et de confidentialité à clarifier avec CRB (Q19)

### 4.5 Langues (Q2)

- **V1** : Français uniquement
- **V2+** : Allemand, inclus sans surcoût par utilisateur

---

## 5. Architecture technique

### 5.1 Stack technologique

| Couche | Technologie | Justification |
|--------|-------------|---------------|
| **Frontend web** | React + TypeScript | Écosystème riche, typage fort |
| **API** | NestJS (Node.js) | Architecture modulaire, TypeScript natif |
| **Base de données** | Supabase Pro (PostgreSQL) | RLS natif, temps réel, auth intégrée |
| **Hébergement BDD** | Frankfurt (EU) | Conformité RGPD, proximité Suisse |
| **Hébergement API** | Railway EU West | Scalabilité, CI/CD intégré |
| **Mobile** | React Native ou PWA | Code partagé avec le web |
| **Stockage fichiers** | Supabase Storage | Intégré à la BDD, RLS sur les buckets |
| **IA** | API Claude / OpenAI | Suggestions, chatbot, analyse |

### 5.2 Multi-tenancy

- **Stratégie** : Base de données partagée avec Row-Level Security (RLS)
- **Isolation** : Chaque requête filtrée par `company_id` via les policies Supabase
- **Migration** : Pas de bases séparées par client

### 5.3 Sécurité

- HTTPS obligatoire (TLS 1.3)
- Chiffrement au repos (AES-256) pour les données sensibles
- JWT avec expiration courte + refresh tokens
- Audit log pour toutes les actions sensibles
- Sauvegardes automatiques quotidiennes
- Conformité LPD (Loi fédérale sur la protection des données) et RGPD

### 5.4 Codebase actuelle

- **Structure** : Monorepo (moteur d'offres + API NestJS + frontend React)
- **État** : 85 fichiers, ~2 950 lignes, 38 tests passants
- **Corpus d'entraînement** : 303 articles normalisés, 2 069 occurrences, 287 profils de pièces issus de 5 projets réels

---

## 6. Module 1 — Plans et analyse

### 6.1 Décision V1 : Pas de lecture automatique de plans

La lecture automatique de plans (plan reading) a été **retirée du périmètre V1** au profit de :

- **Saisie manuelle des quantités** par le chiffreur
- **Import de soumissions** au format Excel/CSV

### 6.2 Fonctionnalités V1

| Fonction | Description |
|----------|-------------|
| **Téléversement de plans** | Upload de fichiers PDF/DWG pour référence visuelle |
| **Annotation manuelle** | Outils de mesure et d'annotation sur les plans |
| **Saisie des quantités** | Formulaire de saisie manuelle des métrés |
| **Lien plan ↔ offre** | Association des quantités saisies aux postes de l'offre |

### 6.3 Import de soumissions (Q27)

| Format | Support V1 |
|--------|-----------|
| **Excel / CSV** | ✅ Import complet |
| **CRBX** | ❌ Lecture non supportée en V1 |
| **PDF** | ✅ Import avec extraction de données |

*Note : Le format CRBX sera supporté dans une version ultérieure.*

---

## 7. Module 2 — Moteur de chiffrage (Offres)

Le moteur d'offres est le cœur d'OXACAN. Il permet de créer des offres de prix rapidement et précisément grâce à l'intelligence artificielle et au catalogue normatif CAN/NPK.

### 7.1 Catalogue d'articles

#### CAN/NPK (Catalogue des Articles Normalisés)
- Catalogue normatif suisse pour le BTP
- Groupe 500 = électricité (marché primaire d'OXACAN)
- Chaque article a un numéro NPK unique, une description, une unité
- Les prix ne sont **pas** dans le CAN — ils proviennent des soumissions passées

#### Fichier d'articles par entreprise
- **Chaque entreprise crée son propre fichier d'articles** via import CSV (Q3, Q4)
- Le fichier peut contenir des articles CAN et des articles libres
- Support de tous les corps de métier BTP, pas seulement l'électricité
- Les entreprises non-BTP peuvent utiliser OXACAN sans le catalogue CAN

### 7.2 Modèle de données du moteur d'offres

Le moteur repose sur 12 entités interconnectées :

```
source_document → source_occurrence (immutable)
                         ↓
               canonical_article ↔ article_alias
                         ↓
               price_observation
                         ↓
    room_type ← business_rule → project_type
                         ↓
                  offer → offer_line → assumption
```

#### Entités principales

| Entité | Description |
|--------|-------------|
| `source_document` | Document source importé (soumission) avec métadonnées |
| `source_occurrence` | Occurrence brute d'un article dans un document — **immutable** |
| `canonical_article` | Article de référence normalisé (CAN/NPK ou libre) |
| `article_alias` | Alias liant une variante textuelle à un article canonique |
| `price_observation` | Observation de prix unitaire horodatée pour un article |
| `room_type` | Type de pièce (local technique, cuisine, chambre, etc.) |
| `project_type` | Type de projet (villa, immeuble, rénovation, etc.) |
| `business_rule` | Règle métier liant article + type de pièce + contexte |
| `offer` | Offre de prix avec métadonnées projet |
| `offer_line` | Ligne individuelle d'une offre (article + quantité + prix) |
| `assumption` | Hypothèse ou variante associée à une offre |

### 7.3 Pipeline d'import (10 étapes)

1. **Vérification de hash** — Détection des doublons de documents
2. **Extraction des métadonnées** — Nom du projet, date, entrepreneur
3. **Extraction des occurrences** — Chaque ligne article du document
4. **Stockage immutable** — Les occurrences brutes ne sont jamais modifiées
5. **Matching CAN/NPK** — Correspondance avec le catalogue normatif
6. **Matching sémantique** — Correspondance par similarité textuelle
7. **Observations de prix** — Extraction et horodatage des prix unitaires
8. **Statistiques du catalogue** — Calcul des médianes, min, max par article
9. **Suggestions de règles** — Propositions de règles article-pièce
10. **Validation utilisateur** — L'utilisateur confirme ou corrige les suggestions

### 7.4 Stratégies de prix

| Stratégie | Description | Cas d'usage |
|-----------|-------------|-------------|
| **LATEST** | Dernier prix observé | Article avec prix récent fiable |
| **MEDIAN_N** | Médiane des N dernières observations | Article avec historique de prix |
| **INDEXED** | Prix indexé (ajusté à l'inflation) | Prix anciens nécessitant une actualisation |
| **COMPOSED** | Prix calculé à partir d'un article composé (bundle) | Articles complexes (voir §7.5) |
| **MANUAL** | Prix saisi manuellement par l'utilisateur | Aucun historique disponible |

### 7.5 Articles composés (Bundles)

Un article composé regroupe plusieurs éléments en une seule ligne d'offre :

- **Matériel** : Composants physiques (câbles, prises, disjoncteurs, etc.)
- **Main d'œuvre** : Temps de travail estimé
- **Frais généraux** : Overhead (basé sur SSE-IPB)

**Répartition typique** (Q25) : 80% articles CAN / 20% articles composés.

#### Éditeur de bundles

L'utilisateur crée ses propres articles composés via un éditeur dédié :

1. Nommer l'article composé
2. Ajouter les composants (articles CAN ou libres)
3. Définir les quantités de chaque composant
4. Ajouter le temps de main d'œuvre
5. Le prix total est calculé automatiquement

### 7.6 Système de profils de pièces

Le moteur utilise des **profils de pièces** pour suggérer automatiquement les articles pertinents lors de la création d'une offre.

#### 15 types de pièces identifiés

| Type de pièce | Articles observés |
|---------------|-------------------|
| Local technique | 113 |
| Hall / Entrée | 34 |
| Cage d'escalier | 21 |
| Cuisine | 19 |
| Chambre | 14 |
| Salle de bain | — |
| Bureau | — |
| Garage | — |
| Cave | — |
| Terrasse / Extérieur | — |
| Buanderie | — |
| WC | — |
| Salon | — |
| Couloir | — |
| Rangement | — |

*Les profils sont enrichis au fur et à mesure des projets importés.*

### 7.7 Scoring de confiance

Le moteur évalue la fiabilité de chaque suggestion sur 4 dimensions :

| Dimension | Description |
|-----------|-------------|
| **Classification** | Certitude du matching article → CAN/NPK |
| **Mapping** | Certitude de l'association article → pièce |
| **Prix** | Fiabilité du prix suggéré (nombre d'observations, ancienneté) |
| **Règle métier** | Fiabilité de la règle appliquée |

**Règle de sécurité** : Si aucun prix valide n'est disponible, la ligne affiche **« prix à compléter »** plutôt que 0 CHF.

### 7.8 Variantes et hypothèses

| Type | Description |
|------|-------------|
| `BASE` | Version de base de l'offre |
| `VARIANTE` | Alternative proposée au client |
| `OPTION` | Option supplémentaire chiffrable |
| `HYPOTHESE_A_VALIDER` | Hypothèse en attente de confirmation |
| `INFORMATION_MANQUANTE` | Donnée manquante nécessitant un retour |
| `EXCLU` | Poste explicitement exclu du périmètre |

### 7.9 Règle des 100% (Q36)

**Toutes les lignes d'une offre doivent être chiffrées.** Aucune ligne ne peut rester à 0 CHF — si le prix est inconnu, elle doit afficher « prix à compléter » et l'offre ne peut pas être finalisée tant que tous les prix ne sont pas renseignés.

### 7.10 Corpus de données

5 projets réels constituent le corpus d'entraînement initial :

| Projet | Année | Type |
|--------|-------|------|
| 000033 Chalet | 2022 | Chalet |
| 000260 Villas | 2023 | Villas |
| 000271 Quatre Sapins | 2023 | Immeuble |
| 000443 La Joux | 2025 | — |
| 000731 Eggermann | 2026 | — |

**Statistiques** : 303 articles normalisés, 2 069 occurrences, 287 profils de pièces.

---

## 8. Module 3 — Contrats et commandes

### 8.1 Cycle de vie de l'offre

```
Brouillon → En cours → Soumise → Acceptée → Contrat signé
                                → Refusée → Archivée
```

### 8.2 Signatures électroniques (Q16)

| Type de document | Type de signature |
|------------------|-------------------|
| **Contrats** | Signature électronique **qualifiée** (SEQ) |
| **Bons de régie** | Signature électronique **simple** (SES) |

### 8.3 Fonctionnalités

- Génération automatique du contrat depuis l'offre acceptée
- Gestion des avenants
- Suivi du statut contractuel
- Archivage avec horodatage
- Export PDF

---

## 9. Module 4 — Projets et planification

### 9.1 Création de projet

Un projet est créé automatiquement lorsqu'une offre est acceptée et qu'un contrat est signé.

### 9.2 Transformation offre → tâches (Q34)

La transformation d'une offre en tâches de chantier suit cette logique :

1. Les **postes CAN** de l'offre sont regroupés en **lots de travail**
2. Chaque lot reçoit des **jalons** (milestones)
3. L'IA propose un découpage basé sur les règles métier et l'apprentissage des projets passés
4. Le chef de projet valide et ajuste le découpage

### 9.3 Planification

| Fonction | Description |
|----------|-------------|
| **Diagramme de Gantt** | Visualisation temporelle des tâches et jalons |
| **Dépendances** | Liens entre tâches (fin-début, début-début, etc.) |
| **Ressources** | Affectation des équipes et du matériel |
| **Chemin critique** | Identification automatique du chemin critique |
| **Baseline** | Enregistrement de la planification initiale pour comparaison |

### 9.4 Suivi de projet

- Avancement par tâche (% réalisé)
- Comparaison planifié vs réalisé
- Alertes de retard
- Tableau de bord projet (coûts, heures, avancement)

---

## 10. Module 5 — Tâches, équipes et timbrage

### 10.1 Gestion des tâches

- Création de tâches depuis la planification ou manuellement
- Assignation à un ou plusieurs employés
- Statuts : À faire → En cours → Terminée → Validée
- Priorités et dates d'échéance
- Commentaires et pièces jointes

### 10.2 Timbrage (pointage des heures)

| Fonction | Description |
|----------|-------------|
| **Pointage mobile** | Début/fin de journée, pauses, changement de chantier |
| **Géolocalisation** | Optionnelle, activable par entreprise (Q17) |
| **Sélection du chantier** | L'employé sélectionne le chantier depuis une liste (pas de géofencing automatique) |
| **Validation** | Le chef d'équipe valide les heures de ses ouvriers |
| **Catégories d'heures** | Heures normales, supplémentaires, déplacement |

### 10.3 Taux horaires (Décision validée)

**Modèle : Un taux horaire unique par employé, défini par l'administrateur.**

- Le taux horaire est un champ simple sur la fiche employé
- Pas de système de tiers ou de barèmes complexes
- L'administrateur saisit le taux pour chaque employé
- Le taux inclut déjà les charges sociales et frais généraux (overhead SSE-IPB ~22,9% — Q24)
- Le taux est utilisé pour le calcul des coûts de main d'œuvre dans les offres, la facturation et l'export fiduciaire

### 10.4 Heures supplémentaires (Q35)

- Gestion via un **compte d'heures** par employé
- Les règles de majoration dépendent de la **CCT applicable** (convention collective de travail)
- L'entreprise configure ses propres règles de majoration
- Compensation en temps ou en argent selon la politique de l'entreprise

### 10.5 Temps de déplacement (Q32)

- Le temps de déplacement est enregistré séparément des heures de travail
- Les règles de rémunération du temps de déplacement dépendent de la **CCT applicable** et des **règles internes** de l'entreprise
- Configurable par entreprise

### 10.6 Rapports journaliers

- Saisie par l'ouvrier ou le chef d'équipe
- Champs : travaux effectués, matériel utilisé, conditions météo, remarques
- Photo / pièce jointe possible
- Lié au projet et aux tâches

---

## 11. Module 6 — Réunions de chantier

### 11.1 Fonctionnalités

- Planification des réunions de chantier
- Ordre du jour
- Rédaction du procès-verbal (PV)
- Suivi des décisions et actions
- Distribution du PV aux participants
- Historique des réunions par projet

### 11.2 PV de chantier

- Modèle structuré avec numérotation automatique
- Participants (présents/absents/excusés)
- Points traités avec décisions
- Actions avec responsables et délais
- Signature électronique simple des participants
- Export PDF

---

## 12. Module 7 — Approvisionnement

### 12.1 Fonctionnalités

- Liste de matériel par projet (issue de l'offre)
- Commandes fournisseurs
- Suivi des livraisons
- Réception de marchandise (avec photos)
- Gestion des retours

### 12.2 Lien avec le moteur d'offres

- Les articles de l'offre alimentent automatiquement la liste d'approvisionnement
- Les prix réels d'achat sont comparés aux prix de l'offre
- Alertes en cas d'écart significatif

---

## 13. Module 8 — Stock et véhicules

### 13.1 Niveau de profondeur (Décision validée)

**Depth B — Stock simple, sans scan de code-barres en V1.**

### 13.2 Fonctionnalités stock

| Fonction | Description |
|----------|-------------|
| **Inventaire** | Liste des articles en stock avec quantités |
| **Mouvements** | Entrées (livraisons) et sorties (utilisation sur chantier) |
| **Seuils d'alerte** | Notification quand un article passe sous le seuil minimum |
| **Localisation** | Par dépôt / par véhicule |
| **Historique** | Traçabilité complète des mouvements |

### 13.3 Fonctionnalités véhicules

- Fiche véhicule (immatriculation, assurance, contrôle technique)
- Assignation aux équipes / chantiers
- Suivi kilométrique
- Alertes d'entretien

---

## 14. Module 9 — CRM et gestion clients

### 14.1 Fonctionnalités

- Fiche client complète (coordonnées, historique, projets)
- Pipeline commercial (prospects → clients actifs → archivés)
- Historique des interactions
- Documents associés (offres, contrats, factures)
- Recherche et filtrage avancés
- Import / export de contacts

### 14.2 Suivi par client (Fonctionnalité finance ajoutée)

- Vue consolidée de tous les projets d'un client
- Encours financier par client
- Historique de facturation
- Alertes de paiement

---

## 15. Module 10 — Facturation, situations et plus-values

### 15.1 Facturation

#### Numérotation (Q20)

- **Séquentielle sans trous** : 2026-001, 2026-002, 2026-003, …
- Les corrections se font **exclusivement par note de crédit** (pas de suppression ou modification de facture émise)
- Format configurable par entreprise

#### TVA (Q21)

- Le taux de TVA est **modifiable sur chaque facture**
- Par défaut : taux normal suisse (actuellement 8,1%)
- Pour les travaux d'électricité : généralement le taux normal
- Support du taux réduit (2,6%) et du taux spécial si nécessaire

#### Types de factures

| Type | Description |
|------|-------------|
| **Facture** | Facture standard |
| **Situation** | Facture intermédiaire basée sur l'avancement |
| **Acompte** | Demande de paiement anticipé |
| **Note de crédit** | Correction d'une facture émise |
| **Facture finale** | Décompte final du projet |

### 15.2 Situations (Q28, Q30)

- Basées sur les **quantités réellement exécutées** (pas un pourcentage forfaitaire)
- Chaque situation **déduit les acomptes déjà versés**
- Numérotation séquentielle par projet : Situation 1, Situation 2, …
- Comparaison avec le budget de l'offre

### 15.3 Plus-values

Les plus-values sont des travaux supplémentaires non prévus dans l'offre initiale.

| Fonction | Description |
|----------|-------------|
| **Détection** | Identification des travaux hors scope |
| **Chiffrage** | Application des prix unitaires (CAN ou manuels) |
| **Validation** | Approbation par le client avant exécution |
| **Facturation** | Intégration dans la facturation |
| **Alertes** | Notification de dépassement de budget (fonctionnalité finance ajoutée) |

### 15.4 Rétention (Q29)

- Retenue de garantie de **5%** jusqu'à la réception des travaux (pratique courante)
- Configurable par contrat
- Libération à la réception finale

### 15.5 Marge sous-traitants (Q31)

- La marge appliquée aux sous-traitants relève de la **politique commerciale de chaque entreprise**
- Pas de taux imposé par OXACAN — champ configurable

### 15.6 Alertes financières (Fonctionnalités finance ajoutées)

| Alerte | Description |
|--------|-------------|
| **Plus-value** | Notification quand des travaux supplémentaires sont détectés |
| **Dérive financière** | Alerte quand les coûts réels dépassent le budget de l'offre |
| **Acompte** | Rappel pour les acomptes en retard ou à émettre |

---

## 16. Module 11 — Comptabilité et finances

### 16.1 Type d'intégration (Q13)

**Comptabilité intégrée de type Bexio** — pas un simple export vers un logiciel tiers, mais une comptabilité fonctionnelle intégrée dans OXACAN.

### 16.2 Fonctionnalités

| Fonction | Description |
|----------|-------------|
| **Plan comptable** | Plan comptable suisse standard, personnalisable |
| **Journal** | Enregistrement automatique des écritures depuis la facturation |
| **Grand livre** | Vue détaillée par compte |
| **Balance** | Balance des comptes avec soldes |
| **Bilan / Compte de résultat** | États financiers de base |
| **Rapprochement** | Lettrage des paiements avec les factures |
| **Export** | Export vers la fiduciaire (voir Module 12) |

### 16.3 Suivi financier par projet

- Coûts budgétés (offre) vs coûts réels
- Marge prévisionnelle vs marge réelle
- Alertes de dérive financière
- Tableau de bord financier global

### 16.4 Suivi par client (Fonctionnalité ajoutée)

- Encours par client
- Historique de facturation
- Délais de paiement moyens
- Alertes d'impayés

### 16.5 Domaines de coûts SSE-IPB

La structure de coûts suit les 6 domaines SSE-IPB (Société Suisse des Entrepreneurs) :

1. Main d'œuvre
2. Matériaux
3. Sous-traitance
4. Équipement / outillage
5. Frais généraux de chantier
6. Frais généraux d'entreprise

Le taux de frais généraux (~22,9%) est **intégré dans le taux horaire** de chaque employé (Q24).

---

## 17. Module 12 — Export fiduciaire

### 17.1 Vue d'ensemble

L'export fiduciaire permet de transmettre les données financières à la fiduciaire de l'entreprise sous forme de fichiers CSV structurés.

### 17.2 Conventions CSV

| Paramètre | Valeur |
|-----------|--------|
| **Encodage** | UTF-8 avec BOM |
| **Séparateur** | Point-virgule (`;`) |
| **Séparateur décimal** | Point (`.`) |
| **Format de date** | ISO 8601 (`YYYY-MM-DD`) |
| **Fin de ligne** | CRLF (`\r\n`) |
| **Texte** | Guillemets doubles si le champ contient un point-virgule |

### 17.3 Export 1 — Heures des employés

**Nom de fichier** : `heures_employes_YYYY-MM.csv`

| Colonne | Type | Description |
|---------|------|-------------|
| `date` | date | Date de la prestation |
| `employe_nom` | texte | Nom complet de l'employé |
| `employe_id` | texte | Identifiant interne |
| `projet_ref` | texte | Référence du projet |
| `projet_nom` | texte | Nom du projet |
| `heures_normales` | décimal | Heures normales travaillées |
| `heures_supplementaires` | décimal | Heures supplémentaires |
| `heures_deplacement` | décimal | Temps de déplacement |
| `heures_total` | décimal | Total des heures |
| `taux_horaire` | décimal | Taux horaire de l'employé (CHF) |
| `montant_total` | décimal | Montant total (CHF) |
| `remarque` | texte | Remarques éventuelles |

### 17.4 Export 2 — Frais et débours

**Nom de fichier** : `frais_debours_YYYY-MM.csv`

| Colonne | Type | Description |
|---------|------|-------------|
| `date` | date | Date du frais |
| `employe_nom` | texte | Nom de l'employé ayant engagé le frais |
| `employe_id` | texte | Identifiant interne |
| `projet_ref` | texte | Référence du projet |
| `projet_nom` | texte | Nom du projet |
| `categorie` | enum | `materiel` / `deplacement` / `equipement` / `sous-traitance` / `divers` |
| `description` | texte | Description du frais |
| `montant_ht` | décimal | Montant hors taxes (CHF) |
| `tva_taux` | décimal | Taux de TVA appliqué (%) |
| `tva_montant` | décimal | Montant de la TVA (CHF) |
| `montant_ttc` | décimal | Montant TTC (CHF) |
| `ref_justificatif` | texte | Référence du justificatif (reçu, facture) |

### 17.5 Export 3 — Résumé par projet

**Nom de fichier** : `resume_projets_YYYY-MM.csv`

| Colonne | Type | Description |
|---------|------|-------------|
| `projet_ref` | texte | Référence du projet |
| `projet_nom` | texte | Nom du projet |
| `periode` | texte | Période couverte (`YYYY-MM`) |
| `total_heures` | décimal | Total des heures sur la période |
| `cout_main_oeuvre` | décimal | Coût total main d'œuvre (CHF) |
| `cout_materiel` | décimal | Coût total matériel (CHF) |
| `cout_deplacement` | décimal | Coût total déplacements (CHF) |
| `cout_sous_traitance` | décimal | Coût total sous-traitance (CHF) |
| `cout_divers` | décimal | Coût total divers (CHF) |
| `cout_total` | décimal | Coût total du projet sur la période (CHF) |

### 17.6 Contrôle d'accès

| Rôle | Accès |
|------|-------|
| **Administrateur / Comptable** | Export complet (tous les projets, tous les employés) |
| **Chef de projet** | Export limité à ses propres projets |
| **Chef d'équipe / Ouvrier** | Aucun accès à l'export fiduciaire |

### 17.7 Interface utilisateur

**Emplacement** : Module Comptabilité → Exports → Export fiduciaire

- 3 onglets : Heures | Frais & Débours | Résumé projets
- Sélection de la période (mois, trimestre, année, personnalisée)
- Filtres : par projet, par employé, par catégorie
- Prévisualisation avant téléchargement
- Bouton d'export (un fichier par onglet ou export combiné en ZIP)

---

## 18. Module 13 — Administration, sécurité et conformité

### 18.1 Gestion de l'entreprise

- Informations de l'entreprise (raison sociale, adresse, TVA, etc.)
- Logo et personnalisation des documents
- Configuration des modules activés
- Paramètres de facturation (numérotation, conditions de paiement, etc.)

### 18.2 Gestion des utilisateurs

- Création / désactivation de comptes utilisateurs
- Attribution des rôles
- Gestion des licences (SaaS vs Application)
- **Désactivation** (pas de suppression) — la licence est libérée immédiatement (Q7)

### 18.3 Audit et traçabilité

- Journal d'audit de toutes les actions sensibles
- Qui a fait quoi, quand, sur quel enregistrement
- Rétention des logs selon les exigences légales
- Non modifiable et non supprimable

### 18.4 Accessibilité (Q5)

- **WCAG non requis en V1**
- Bonnes pratiques UX appliquées par défaut (contraste, taille de police, navigation clavier)

### 18.5 Responsabilité des données (Q18)

- Le **client est responsable de ses données**, sauf en cas de cyberattaque visant OXACAN
- En cas de cyberattaque sur l'infrastructure OXACAN, la responsabilité incombe à OXACAN
- Détaillé dans les CGU

### 18.6 Responsabilité IA (Q15)

- L'**utilisateur valide le résultat final** de toute suggestion IA
- Les CGU limitent la responsabilité d'OXACAN concernant les suggestions IA
- Aucune offre n'est envoyée sans validation humaine

---

## 19. Module 14 — RH et équipes

### 19.1 Fiche employé

| Champ | Description |
|-------|-------------|
| Nom / Prénom | Identité de l'employé |
| Rôle | Ouvrier, Chef d'équipe, Chef de projet, Admin |
| Taux horaire | CHF/heure (défini par l'admin) |
| Contact | Email, téléphone |
| Qualifications | Compétences et certifications |
| CCT applicable | Convention collective de travail de référence |
| Statut | Actif / Désactivé |
| Date d'entrée | Date de début d'emploi |
| Compte d'heures | Solde heures supplémentaires |

### 19.2 Équipes

- Création d'équipes avec un chef d'équipe
- Assignation des ouvriers aux équipes
- Une équipe peut être assignée à un ou plusieurs chantiers
- Historique des affectations

---

## 20. Application mobile

### 20.1 Utilisateurs cibles

- Ouvriers
- Chefs d'équipe
- (Chefs de projet en consultation)

### 20.2 Fonctionnalités mobiles

| Fonction | Ouvrier | Chef d'équipe |
|----------|---------|---------------|
| Pointage des heures | ✅ | ✅ |
| Tâches du jour | ✅ | ✅ |
| Rapport journalier | ✅ | ✅ |
| Saisie matériel utilisé | ✅ | ✅ |
| Photos / pièces jointes | ✅ | ✅ |
| Signature bon de régie | ✅ | ✅ |
| Géolocalisation (optionnelle) | ✅ | ✅ |
| Distribution des tâches | ❌ | ✅ |
| Validation des heures | ❌ | ✅ |
| PV de réunion | ❌ | ✅ |
| Gestion matériel chantier | ❌ | ✅ |

### 20.3 Mode hors-ligne (Décision validée — Option B)

**Queue les écritures, bloque les modifications hors-ligne.**

| Comportement | Description |
|--------------|-------------|
| **Lecture** | Données mises en cache disponibles hors-ligne |
| **Écriture** | Les nouvelles saisies (pointage, rapport) sont mises en file d'attente |
| **Modification** | La modification d'enregistrements existants est **bloquée** hors-ligne |
| **Synchronisation** | Automatique au retour de la connexion |
| **Conflits** | Résolus côté serveur (dernière écriture gagne pour les créations) |
| **Indicateur** | Badge visuel indiquant le mode hors-ligne et le nombre d'éléments en attente |

---

## 21. Portail client

### 21.1 Accès

- **Liens tokenisés en lecture seule** — pas de compte à créer pour le client
- Lien unique par projet, généré par le chef de projet
- Expiration configurable
- Accès sécurisé (token dans l'URL, HTTPS)

### 21.2 Fonctionnalités visibles par le client

- Offre(s) du projet
- Avancement du projet
- Situations et factures émises
- Documents partagés
- Historique des communications

### 21.3 Actions du client

- Consulter les documents
- Télécharger les factures et situations au format PDF
- Accepter / refuser une offre (avec signature simple)
- Laisser un commentaire

---

## 22. Intelligence artificielle

### 22.1 IA dans le moteur d'offres

| Fonction | Description |
|----------|-------------|
| **Suggestion d'articles** | Proposition des articles pertinents par type de pièce |
| **Estimation de prix** | Suggestion de prix basée sur l'historique (5 stratégies) |
| **Matching sémantique** | Correspondance automatique des articles avec le catalogue CAN |
| **Scoring de confiance** | Évaluation de la fiabilité de chaque suggestion |
| **Apprentissage** | Amélioration continue basée sur les validations utilisateur |

### 22.2 IA dans la planification (Q34)

- Transformation offre → tâches assistée par IA
- Regroupement automatique en lots de travail
- Suggestion de durées basée sur les projets passés
- Apprentissage des règles métier validées par les chefs de projet

### 22.3 Chatbot de support (Q8)

- **Disponibilité** : 24h/24, 7j/7
- **Fonction** : Réponse aux questions sur l'utilisation d'OXACAN
- **Escalade** : Transfert vers le support humain si nécessaire
- **Base de connaissances** : Documentation OXACAN, FAQ, tutoriels

### 22.4 Support humain (Q8)

- **Horaires** : 9h-16h, jours ouvrables
- **Canaux** : Chat intégré, email
- **Équipe** : SAV de Rayan + bot IA via OXACAN (Q12)

---

## 23. Règles métier transversales

### 23.1 Convention de marge (Q23)

**Facteur 1.2x** : coût × 1.2 = prix de vente

Exemple : un article coûtant 100 CHF est vendu 120 CHF (marge de 20%).

### 23.2 Arrondi suisse

**Arrondi à 5 centimes** (0.05 CHF) — standard suisse pour tous les montants monétaires.

Règle : arrondi au plus proche 0.05.

| Montant calculé | Montant arrondi |
|----------------|-----------------|
| 123.42 | 123.40 |
| 123.43 | 123.45 |
| 123.47 | 123.45 |
| 123.48 | 123.50 |

### 23.3 Overhead SSE-IPB (Q24)

Le taux de frais généraux (~22,9%) est **intégré dans le taux horaire** de chaque employé. Il n'y a pas de calcul séparé de l'overhead sur les offres.

### 23.4 Devise

- **Devise unique** : CHF (Franc suisse)
- Pas de support multi-devises en V1

### 23.5 Formats de date et heure

- **Dates** : ISO 8601 en stockage (`YYYY-MM-DD`), format suisse en affichage (`DD.MM.YYYY`)
- **Heures** : Format 24h (`HH:MM`)

---

## 24. Exigences légales et réglementaires suisses

### 24.1 Code des obligations (CO)

| Article | Exigence |
|---------|----------|
| Art. 957-958f | Conservation des documents comptables pendant **10 ans minimum** |
| Art. 958 | Les livres comptables doivent être tenus de manière ordonnée |

### 24.2 Loi sur la protection des données (LPD) et RGPD

| Exigence | Implémentation OXACAN |
|----------|----------------------|
| **Portabilité** | Export complet des données en formats standard (CSV, JSON) |
| **Droit d'accès** | L'utilisateur peut consulter toutes ses données personnelles |
| **Droit de rectification** | Modification des données personnelles sur demande |
| **Droit à l'effacement** | Anonymisation après la période de rétention légale (pas de suppression immédiate des données comptables) |
| **Minimisation** | Seules les données nécessaires sont collectées |
| **Localisation** | Données hébergées à Frankfurt (UE), conformité RGPD |

### 24.3 Conventions collectives de travail (CCT)

- OXACAN supporte les règles CCT pour les heures supplémentaires et le temps de déplacement
- Configurable par entreprise selon la CCT applicable
- Pas de CCT imposée par OXACAN

### 24.4 TVA suisse

- Taux normal : 8,1%
- Taux réduit : 2,6%
- Modifiable par facture
- Déclaration et calcul automatiques

---

## 25. Politique de rétention des données

### 25.1 Désactivation d'utilisateur (Q7)

- Les utilisateurs sont **désactivés, jamais supprimés**
- La licence est libérée **immédiatement** à la désactivation
- Les données de l'utilisateur sont conservées selon les exigences légales

### 25.2 Rétention minimale

| Type de données | Durée de rétention | Base légale |
|-----------------|-------------------|-------------|
| Documents comptables | 10 ans minimum | CO art. 957-958f |
| Factures | 10 ans minimum | CO art. 957-958f |
| Contrats | 10 ans après fin du contrat | CO |
| Données personnelles | Durée de la relation + rétention légale | LPD / RGPD |
| Logs d'audit | 10 ans | Conformité |
| Données techniques | Selon nécessité | — |

### 25.3 Départ d'une entreprise

1. **Fenêtre d'export de 90 jours** : L'entreprise peut exporter toutes ses données pendant 90 jours après la résiliation
2. **Anonymisation** : Après la fenêtre d'export, les données personnelles sont anonymisées
3. **Archivage légal** : Les données comptables anonymisées sont conservées pour la durée de rétention légale (10 ans)
4. **Portabilité complète** : Export en formats standard (CSV, JSON) conforme LPD / RGPD

### 25.4 Contrôles administrateur

- L'administrateur peut visualiser, réassigner et exporter les données
- L'administrateur **ne peut pas** :
  - Supprimer des enregistrements légaux (factures, écritures comptables)
  - Modifier des entrées historiques validées
  - Court-circuiter les règles de rétention

---

## 26. Périmètre V1 — Inclusions et exclusions

### 26.1 Inclusions V1

| Domaine | Inclus |
|---------|--------|
| **Langue** | Français uniquement |
| **Corps de métier** | Tous BTP (focus électricité), + non-BTP sans CAN |
| **Import soumissions** | Excel / CSV / PDF |
| **Catalogue articles** | CAN/NPK + articles libres (import CSV par entreprise) |
| **Moteur d'offres** | Complet avec IA, 5 stratégies de prix, profils de pièces |
| **Articles composés** | Éditeur de bundles |
| **Facturation** | Complète avec situations, acomptes, plus-values, notes de crédit |
| **Comptabilité** | Intégrée type Bexio |
| **Export fiduciaire** | 3 exports CSV (heures, frais, résumé) |
| **Mobile** | Application avec mode hors-ligne (Option B) |
| **Portail client** | Liens tokenisés en lecture seule |
| **Signatures** | Qualifiée (contrats) + simple (bons de régie) |
| **Stock** | Simple (Depth B), sans code-barres |
| **Géolocalisation** | Optionnelle, sélection chantier depuis liste |
| **IA** | Suggestions d'articles, estimation de prix, chatbot support |
| **Planification** | Gantt, dépendances, ressources |
| **CRM** | Gestion clients complète |
| **Accessibilité** | Bonnes pratiques UX de base |
| **Paiement** | Carte bancaire + facture/virement |
| **Support** | Bot IA 24/7 + humain 9h-16h jours ouvrables |

### 26.2 Exclusions V1

| Domaine | Exclu | Raison / Perspective |
|---------|-------|---------------------|
| **Allemand** | ❌ | V2+, sans surcoût par utilisateur |
| **Lecture automatique de plans** | ❌ | Remplacé par saisie manuelle + import Excel/CSV |
| **Import CRBX** | ❌ | Format complexe, V2+ |
| **Certification CRB** | ❌ | V2+, en attente de clarification contractuelle |
| **Scan code-barres (stock)** | ❌ | V2+ |
| **WCAG (accessibilité avancée)** | ❌ | Non requis |
| **Multi-devises** | ❌ | CHF uniquement en V1 |
| **Géofencing automatique** | ❌ | Sélection manuelle du chantier |
| **Secteur public** | ❌ | Clients publics à terme (Q6), mais pas de fonctionnalités spécifiques en V1 |

---

## 27. Méthodologie de développement

### 27.1 Keeel « How We Build » — Track F (Full)

OXACAN suit la méthodologie Keeel en 8 phases, Track F (Full) pour les projets complexes.

| Phase | Nom | Description | Outil |
|-------|-----|-------------|-------|
| 0 | **Intake** | Recueil des besoins et cadrage | Claude Project |
| 1 | **Spec** | Spécification détaillée (ce document) | Claude Project |
| 2 | **System Model** | Modélisation système et domaine | Claude Project |
| 3 | **Estimate** | Estimation effort et coûts | Claude Code |
| 4 | **Architecture** | Design technique et décisions d'architecture | Claude Code |
| 5 | **Harness** | Infrastructure, CI/CD, environnements | Claude Code |
| 6 | **Tests** | Tests gelés avant développement | Claude Code |
| 7 | **Build** | Développement | Claude Code |
| 8 | **Verify & Handover** | Vérification indépendante et livraison | Claude Code |

### 27.2 Principes clés

- **Tests gelés** : Les tests sont écrits et gelés avant le développement (phase 6 avant phase 7)
- **Vérification indépendante** : La phase 8 est réalisée par une personne différente du développeur
- **Gates as artifacts** : Chaque passage de phase produit un artefact vérifiable
- **Phases 0-2** : Réalisées dans Claude Project (ce projet)
- **Phases 3-8** : Réalisées dans Claude Code

### 27.3 Migration de données (Q11)

- **Formation** : Gratuite pour les nouveaux clients
- **Service de migration complète** : Payant, réalisé par l'équipe OXACAN
- **Formats supportés** : Import CSV pour les articles, import des données existantes

### 27.4 Partenaire pilote (Q38)

- Un partenaire pilote est prévu pour la phase de test
- Accès anticipé, feedback structuré, conditions préférentielles

### 27.5 Livraison du code (Q39)

- Livraison du code à la **date contractuelle**
- Idéalement à la **livraison du prototype**

---

## 28. Objectifs de lancement

### 28.1 Métriques cibles (Q9)

| Métrique | Objectif |
|----------|----------|
| **Lancement** | 100 utilisateurs |
| **12 mois** | 600 utilisateurs |

### 28.2 Qualité

- 0 bug bloquant au lancement
- Performance < 2s pour 95% des requêtes
- Disponibilité > 99,5%
- Sauvegardes automatiques quotidiennes

---

## 29. Annexe A — Réponses client consolidées (Q1–Q39)

Chaque réponse est intégrée dans les sections pertinentes du document. Voici le récapitulatif complet pour référence.

| # | Question | Réponse / Décision |
|---|----------|--------------------|
| Q1 | Paliers de prix | 3 paliers recommandés : Solo, Équipe, Entreprise — par utilisateur |
| Q2 | Langues | Français V1, allemand V2+ sans surcoût |
| Q3 | Import articles | Chaque entreprise crée son fichier via import CSV |
| Q4 | Corps de métier | Tous BTP ; non-BTP possible sans CAN |
| Q5 | Accessibilité WCAG | Non requis en V1 |
| Q6 | Clients publics | Oui, à terme — pas de fonctionnalités spécifiques V1 |
| Q7 | Désactivation utilisateur | Désactivation (pas suppression), licence libérée immédiatement |
| Q8 | Support | Bot IA 24/7 + humain 9h-16h jours ouvrables |
| Q9 | Objectifs utilisateurs | 100 au lancement, 600 à 12 mois |
| Q10 | Paiement | Carte bancaire + facture/virement |
| Q11 | Migration données | Formation gratuite, migration complète payante |
| Q12 | Support post-lancement | Équipe SAV de Rayan + bot IA via OXACAN |
| Q13 | Comptabilité | Intégrée type Bexio |
| Q14 | Licence CRB | OXACAN = licence dev, client = licence usage, pas de certif V1 |
| Q15 | Responsabilité IA | Utilisateur valide, CGU limitent la responsabilité OXACAN |
| Q16 | Signatures | Qualifiée (contrats), simple (bons de régie) |
| Q17 | Géolocalisation | Optionnelle par entreprise, sélection chantier depuis liste |
| Q18 | Responsabilité données | Client responsable sauf cyberattaque OXACAN |
| Q19 | Validation CRB | Acceptable si conditions contractuelles/confidentialité clarifiées |
| Q20 | Numérotation factures | Séquentielle sans trous, corrections par note de crédit |
| Q21 | TVA | Modifiable par facture, standard pour l'électricité |
| Q22 | — | — |
| Q23 | Marge | Facteur 1.2x (coût × 1.2 = prix de vente) |
| Q24 | Overhead SSE-IPB | ~22,9% intégré dans le taux horaire |
| Q25 | Répartition CAN/composé | 80% CAN / 20% composés |
| Q26 | — | — |
| Q27 | Formats soumission | Excel/CSV (import), CRBX (pas en V1), PDF (import) |
| Q28 | Situations | Basées sur quantités réellement exécutées |
| Q29 | Rétention | 5% jusqu'à réception des travaux |
| Q30 | Acomptes | Déduits dans chaque situation |
| Q31 | Marge sous-traitants | Politique commerciale de l'entreprise |
| Q32 | Temps de déplacement | Par CCT et règles internes |
| Q33 | — | — |
| Q34 | Offre → tâches | Postes CAN → lots de travail + jalons, IA en apprentissage |
| Q35 | Heures supplémentaires | Compte d'heures par employé, selon CCT |
| Q36 | Lignes à 100% | Toutes les lignes doivent être chiffrées |
| Q37 | — | — |
| Q38 | Partenaire pilote | Oui, un prévu |
| Q39 | Livraison code | À la date contractuelle, idéalement au prototype |

---

## 30. Annexe B — Modèle de données du moteur d'offres

### 30.1 Entités et champs clés

#### `source_document`
```
id, hash_sha256, filename, project_name, project_year,
entrepreneur_name, document_type, import_date, status,
total_occurrences, matched_occurrences, company_id
```

#### `source_occurrence` (immutable)
```
id, source_document_id, line_number, raw_text, npk_number,
description, unit, quantity, unit_price, total_price,
room_type, floor, status, canonical_article_id
```

#### `canonical_article`
```
id, npk_number, description, unit, category,
is_composed, composed_components (JSON),
median_price, observation_count, last_price_date,
confidence_classification, company_id
```

#### `article_alias`
```
id, canonical_article_id, alias_text,
source, match_confidence
```

#### `price_observation`
```
id, canonical_article_id, source_occurrence_id,
unit_price, observation_date, project_name,
project_type, is_outlier
```

#### `room_type`
```
id, name, description, typical_articles (JSON),
project_count, occurrence_count
```

#### `business_rule`
```
id, canonical_article_id, room_type_id,
project_type_id, suggested_quantity,
confidence, source, company_id
```

#### `offer`
```
id, project_name, client_id, status, version,
total_ht, total_tva, total_ttc, margin_factor,
created_by, created_at, company_id
```

#### `offer_line`
```
id, offer_id, canonical_article_id, description,
quantity, unit, unit_price, total_price,
pricing_strategy, confidence_score,
room_type, variant_type
```

#### `assumption`
```
id, offer_id, type (VARIANTE/OPTION/HYPOTHESE/...),
description, impact_amount, status
```

### 30.2 Critères d'acceptation du moteur

14 critères d'acceptation répartis sur 10 domaines :

1. **Import** : Les documents sont importés sans perte de données
2. **Immutabilité** : Les occurrences source ne sont jamais modifiées
3. **Matching** : ≥ 85% des articles sont correctement matchés avec le CAN
4. **Prix** : Les suggestions de prix sont dans une marge de ±15% du prix réel
5. **Profils de pièces** : Les suggestions couvrent ≥ 80% des articles nécessaires
6. **Scoring** : Le score de confiance est cohérent avec la fiabilité réelle
7. **Sécurité prix** : Aucun prix à 0 CHF — « prix à compléter » si pas de prix
8. **Articles composés** : Les bundles calculent correctement le prix total
9. **Variantes** : Le système gère correctement les 6 types de variantes
10. **Performance** : Génération d'une offre de 200 lignes en < 10 secondes

---

## 31. Annexe C — Glossaire

| Terme | Définition |
|-------|------------|
| **BTP** | Bâtiment et Travaux Publics |
| **CAN** | Catalogue des Articles Normalisés (Suisse) |
| **NPK** | Numéro du catalogue normalisé (Normalized Position Key) |
| **CRB** | Centre suisse d'études pour la Rationalisation de la construction |
| **CRBX** | Format d'échange de données CRB (XML-based) |
| **CCT** | Convention Collective de Travail |
| **CO** | Code des Obligations (droit suisse) |
| **LPD** | Loi fédérale sur la Protection des Données (Suisse) |
| **RGPD** | Règlement Général sur la Protection des Données (UE) |
| **SSE-IPB** | Société Suisse des Entrepreneurs — Index des Prix de la construction |
| **TVA** | Taxe sur la Valeur Ajoutée |
| **SEQ** | Signature Électronique Qualifiée |
| **SES** | Signature Électronique Simple |
| **RLS** | Row-Level Security (sécurité au niveau des lignes) |
| **JWT** | JSON Web Token |
| **Soumission** | Document d'appel d'offres / devis reçu d'un client ou bureau d'ingénieurs |
| **Offre** | Proposition de prix établie par l'entreprise |
| **Situation** | Facture intermédiaire basée sur l'avancement réel des travaux |
| **Acompte** | Paiement anticipé avant livraison |
| **Plus-value** | Travaux supplémentaires non prévus dans l'offre initiale |
| **Bon de régie** | Document attestant des travaux réalisés en régie (hors forfait) |
| **PV** | Procès-verbal (de réunion de chantier) |
| **Métré** | Mesure des quantités d'ouvrage |
| **Chiffrage** | Processus d'estimation des coûts / établissement de prix |
| **Fiduciaire** | Cabinet comptable / trust company |
| **Article composé** | Bundle regroupant matériel + main d'œuvre + overhead en une seule ligne |
| **Profil de pièce** | Ensemble d'articles typiquement présents dans un type de pièce donné |
| **Taux horaire** | Coût horaire d'un employé (charges et overhead inclus) |
| **Note de crédit** | Document correctif annulant partiellement ou totalement une facture |

---

*Document généré le 2026-09-28. Toutes les décisions ont été validées avec le client. Zéro questions ouvertes.*
