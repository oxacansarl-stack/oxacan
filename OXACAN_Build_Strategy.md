# OXACAN — Complete Build Strategy & Engineering Blueprint

**Version:** 1.1  
**Date:** 2026-09-28  
**Purpose:** Step-by-step engineering plan for building OXACAN with Claude Code, including context management, data model, security, observability, and resilience.

> **v1.1 changelog:** Fixed 13 gaps identified during PRD cross-review — added plans module, subscription/billing tables, expense table, idempotency key table, push_device table, data_export_request & anonymization_job tables; fixed hosting (Railway EU West for web too); standardized ORM to TypeORM; rewrote RLS as dual-layer (app-level primary + RLS safety net); removed Redis references; added PDF generation, file storage, e-signature, and push notification architecture sections; added 2 new risks to register.

---

## Table of Contents

1. [The Core Problem: Building a 14-Module ERP with Claude Code](#1-the-core-problem)
2. [Context Engineering Strategy](#2-context-engineering-strategy)
3. [Repository Structure](#3-repository-structure)
4. [Build Phases & Ordering](#4-build-phases--ordering)
5. [Complete Database Schema](#5-complete-database-schema)
6. [Backend Architecture](#6-backend-architecture)
7. [Frontend Architecture](#7-frontend-architecture)
8. [Security Architecture](#8-security-architecture)
9. [Observability & Monitoring](#9-observability--monitoring)
10. [Resilience & Error Handling](#10-resilience--error-handling)
11. [Testing Strategy](#11-testing-strategy)
12. [Mobile App Strategy](#12-mobile-app-strategy)
13. [CI/CD Pipeline](#13-cicd-pipeline)
14. [What Info to Provide at Each Stage](#14-what-info-to-provide-at-each-stage)
15. [Risk Register](#15-risk-register)

---

## 1. The Core Problem

We're building a 17-module Swiss construction ERP — billing, accounting, field tracking, AI pricing — using Claude Code as the primary development tool. Two fundamental risks:

1. **Scale**: ~50+ database tables, ~120+ API endpoints, ~80+ frontend pages across web and mobile. A single Claude Code session cannot hold all of this in context simultaneously.

2. **Context decay**: After a week of building, earlier decisions, schema details, and business rules get diluted. Without deliberate context engineering, we'll introduce inconsistencies, break contracts, and duplicate logic.

**The strategy that follows solves both problems.**

---

## 2. Context Engineering Strategy

This is the most critical section. Every other section depends on it.

### 2.1 The CLAUDE.md System (Ground Truth Files)

Claude Code reads `CLAUDE.md` files at the root and in each directory automatically. These are our **persistent context** — the information Claude Code loads on every session start.

```
oxacan/
├── CLAUDE.md                          # Root: project overview, stack, conventions, module index
├── packages/
│   ├── db/
│   │   └── CLAUDE.md                  # Schema overview, migration conventions, RLS rules
│   ├── api/
│   │   └── CLAUDE.md                  # API conventions, auth patterns, endpoint index
│   ├── web/
│   │   └── CLAUDE.md                  # Component library, routing, state management patterns
│   └── mobile/
│       └── CLAUDE.md                  # Mobile-specific patterns, offline queue
```

#### Root CLAUDE.md contains:
```markdown
# OXACAN — Swiss Construction ERP

## Stack
- **DB**: PostgreSQL 15 via Supabase Pro (Frankfurt)
- **API**: NestJS 10 + TypeScript 5.x
- **Web**: React 18 + TypeScript + Tailwind + shadcn/ui
- **Mobile**: React Native (Expo)
- **Hosting**: Railway EU West (API + Web static), Supabase (DB)
- **Storage**: Supabase Storage with RLS on buckets
- **PDF**: ReportLab (Python) microservice on Railway
- **E-Signatures**: Swisscom Trust Services (QES)
- **Email**: Resend Pro (transactional)
- **Monitoring**: Sentry EU (errors) + PostHog EU (analytics)
- **ORM**: TypeORM (entities, repositories, migrations via raw SQL files)

## Conventions
- All monetary values: integer centimes (CHF). 100 = 1.00 CHF. Swiss 5ct rounding at display.
- All dates: ISO 8601 in storage, DD.MM.YYYY in UI.
- Multi-tenant: every table has `company_id`, enforced by RLS.
- Auth: Supabase Auth + JWT. 4 roles: ADMIN, PROJECT_MANAGER, TEAM_LEADER, WORKER.
- API responses: { data, meta, error } envelope.
- DB naming: snake_case. API naming: camelCase. 
- Margin factor: 1.2x (cost × 1.2 = selling price).
- Invoice numbering: sequential, gapless, corrections by credit note only.
- Language: French UI labels (V1). Code and comments in English.

## Module Index (build order)
1. core (auth, company, users)
2. crm (clients, contacts)
3. catalogue (articles, CAN/NPK, article aliases, price observations)
4. plans (PDF/DWG upload, annotation, plan↔offer linking)
5. offers (offer engine, pricing strategies, room profiles, bundles)
6. contracts (offer→contract, amendments, e-signatures)
7. projects (project from contract, planning, Gantt)
8. tasks (task management, assignments, dependencies)
9. timekeeping (timbrage, hours, geolocation, validation, expenses)
10. hr (employees, hourly rates, overtime, CCT rules)
11. procurement (purchase orders, deliveries, supplier invoices)
12. stock (inventory, movements, vehicles)
13. invoicing (invoices, situations, credit notes, acomptes, plus-values)
14. accounting (chart of accounts, journal entries, ledger, fiduciary export)
15. admin (company settings, audit log, data retention, subscription/billing)
16. ai (chatbot, offer suggestions, offer→task transformation)
17. portal (client portal, token-based read-only access)

## Key Business Rules (always active)
- No price at 0 CHF → must show "prix à compléter"
- All offer lines must be priced before finalization
- source_occurrence records are IMMUTABLE after import
- Invoices: sequential numbering, no gaps, no deletion
- Users are DEACTIVATED not deleted; licence freed immediately
- 10-year minimum retention for accounting documents
- 5% retention until project reception (configurable)
```

### 2.2 Module-Scoped Context Files

Each module gets its own specification file that Claude Code reads when working in that directory:

```
packages/api/src/modules/invoicing/
├── CLAUDE.md           # Module spec: entities, endpoints, business rules, edge cases
├── SPEC.md             # Detailed specification extracted from PRD
├── invoicing.module.ts
├── invoicing.service.ts
├── invoicing.controller.ts
├── dto/
├── entities/
└── __tests__/
```

The module-level `CLAUDE.md` contains:
- The 3-5 most critical business rules for that module
- Entity list with key fields
- API endpoint summary
- Cross-module dependencies (which other modules it calls)
- Known edge cases and how they're handled

### 2.3 Session Strategy: One Module Per Session

**Rule: Never build more than one module in a single Claude Code session.**

Why: A module takes 2-4 hours. After ~60 minutes of intensive coding, context starts to blur. Better to finish one module cleanly, commit, update the CLAUDE.md files, and start fresh.

#### Session template:

```
Session start → Claude Code reads CLAUDE.md files automatically
  → "Build module X. The spec is in packages/api/src/modules/X/SPEC.md.
     Related schemas are in packages/db/migrations/. 
     Run existing tests first to verify nothing is broken."
  → Build: entities → service → controller → tests → frontend pages
  → End: commit, update CLAUDE.md with any new conventions discovered
```

### 2.4 The Knowledge Base Files

Beyond CLAUDE.md, maintain reference files that can be explicitly loaded when needed:

```
docs/
├── DATA_MODEL.md              # Complete schema reference (auto-generated from migrations)
├── API_REFERENCE.md           # All endpoints (auto-generated from controllers)
├── BUSINESS_RULES.md          # All business rules in one place
├── SECURITY.md                # Security architecture and threat model
├── DECISIONS.md               # Architecture Decision Records (ADRs)
├── CROSS_MODULE_CONTRACTS.md  # Interfaces between modules
└── GLOSSARY.md                # French BTP terminology
```

### 2.5 Automated Context Refresh

After each module is built, run a script that regenerates reference docs:

```bash
# scripts/refresh-context.sh
# 1. Regenerate DATA_MODEL.md from actual DB schema (TypeORM — no Prisma)
npx ts-node scripts/schema-to-markdown.ts > docs/DATA_MODEL.md

# 2. Regenerate API_REFERENCE.md from NestJS Swagger
npx ts-node scripts/swagger-to-markdown.ts > docs/API_REFERENCE.md

# 3. Run all tests to verify integrity
npm test -- --ci

# 4. Update root CLAUDE.md module status
node scripts/update-module-status.js
```

### 2.6 Cross-Module Contract Files

The biggest context risk is **breaking module boundaries**. Each pair of interacting modules has an explicit contract:

```typescript
// packages/shared/contracts/offer-to-project.contract.ts
export interface OfferToProjectContract {
  // When an offer is accepted, this is what the project module receives
  createProjectFromOffer(input: {
    offerId: string;
    offerLines: OfferLineSnapshot[];
    clientId: string;
    companyId: string;
  }): Promise<{ projectId: string; lots: LotSnapshot[] }>;
}
```

These contract files are **never deleted or modified** without updating both sides. They live in `packages/shared/contracts/` and Claude Code sees them because the root CLAUDE.md references them.

### 2.7 Memory Management with Claude Project

Keep the Claude Project (this project) as the **strategic memory**:
- PRD → already saved
- Build Strategy → this document
- Per-module status updates → after each module is complete, update overview.md

Keep the repo CLAUDE.md files as the **tactical memory**:
- These are what Claude Code actually reads
- They contain the "what you need to know right now" for each area

### 2.8 The "Resumption Protocol"

When starting a new Claude Code session after days/weeks away:

```
1. Claude Code auto-reads CLAUDE.md files
2. Explicitly ask: "Read docs/DATA_MODEL.md and docs/CROSS_MODULE_CONTRACTS.md"
3. Ask: "Run `npm test` and report any failures"
4. Then: "We're working on module X today. Read packages/api/src/modules/X/SPEC.md"
```

This takes 30 seconds and gives Claude Code everything it needs.

---

## 3. Repository Structure

### 3.1 Monorepo Layout

```
oxacan/
├── CLAUDE.md
├── package.json                    # Workspace root
├── turbo.json                      # Turborepo config
├── .env.example                    # Template (never real secrets)
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                  # Lint + test + build on every PR
│   │   ├── deploy-staging.yml      # Deploy to staging on merge to develop
│   │   └── deploy-production.yml   # Deploy to prod on release tag
│   └── CODEOWNERS
├── docs/                           # Auto-generated + manual reference docs
├── scripts/                        # Build/deploy/context-refresh scripts
│
├── packages/
│   ├── shared/                     # Shared types, contracts, utilities
│   │   ├── src/
│   │   │   ├── types/              # Domain types used across packages
│   │   │   ├── contracts/          # Cross-module interface contracts
│   │   │   ├── constants/          # Business constants (VAT rates, rounding)
│   │   │   ├── utils/              # Swiss rounding, date formatting, validation
│   │   │   └── errors/             # Typed error hierarchy
│   │   └── CLAUDE.md
│   │
│   ├── db/                         # Database layer
│   │   ├── migrations/             # Numbered SQL migrations
│   │   ├── seeds/                  # Seed data for dev/test
│   │   ├── policies/               # RLS policy files (per-table)
│   │   ├── functions/              # PostgreSQL functions (triggers, etc.)
│   │   └── CLAUDE.md
│   │
│   ├── api/                        # NestJS backend
│   │   ├── src/
│   │   │   ├── main.ts
│   │   │   ├── app.module.ts
│   │   │   ├── common/             # Guards, interceptors, pipes, filters
│   │   │   │   ├── guards/
│   │   │   │   │   ├── jwt-auth.guard.ts
│   │   │   │   │   ├── roles.guard.ts
│   │   │   │   │   └── company-context.guard.ts
│   │   │   │   ├── interceptors/
│   │   │   │   │   ├── audit-log.interceptor.ts
│   │   │   │   │   ├── response-envelope.interceptor.ts
│   │   │   │   │   └── performance.interceptor.ts
│   │   │   │   ├── filters/
│   │   │   │   │   └── global-exception.filter.ts
│   │   │   │   └── pipes/
│   │   │   │       └── swiss-rounding.pipe.ts
│   │   │   │
│   │   │   └── modules/            # One directory per domain module
│   │   │       ├── auth/
│   │   │       ├── company/
│   │   │       ├── crm/
│   │   │       ├── catalogue/
│   │   │       ├── plans/
│   │   │       ├── offers/
│   │   │       ├── contracts/
│   │   │       ├── projects/
│   │   │       ├── tasks/
│   │   │       ├── timekeeping/
│   │   │       ├── hr/
│   │   │       ├── procurement/
│   │   │       ├── stock/
│   │   │       ├── invoicing/
│   │   │       ├── accounting/
│   │   │       ├── admin/
│   │   │       ├── ai/
│   │   │       └── portal/
│   │   └── CLAUDE.md
│   │
│   ├── web/                        # React frontend
│   │   ├── src/
│   │   │   ├── app/                # Route-based code splitting
│   │   │   │   ├── (auth)/         # Login, password reset
│   │   │   │   ├── (dashboard)/    # Main layout + sidebar
│   │   │   │   │   ├── crm/
│   │   │   │   │   ├── plans/
│   │   │   │   │   ├── offers/
│   │   │   │   │   ├── projects/
│   │   │   │   │   ├── tasks/
│   │   │   │   │   ├── timekeeping/
│   │   │   │   │   ├── invoicing/
│   │   │   │   │   ├── accounting/
│   │   │   │   │   ├── stock/
│   │   │   │   │   ├── hr/
│   │   │   │   │   ├── admin/
│   │   │   │   │   └── ...
│   │   │   │   └── portal/         # Client portal (separate layout)
│   │   │   ├── components/         # Shared UI components
│   │   │   │   ├── ui/             # shadcn/ui primitives
│   │   │   │   ├── forms/          # Form components (Swiss-specific)
│   │   │   │   ├── tables/         # Data table with sorting/filtering/pagination
│   │   │   │   ├── layout/         # Shell, sidebar, topbar
│   │   │   │   └── domain/         # Domain-specific (OfferLineEditor, GanttChart, etc.)
│   │   │   ├── hooks/              # Custom hooks
│   │   │   ├── lib/                # API client, auth, utils
│   │   │   ├── stores/             # Zustand stores
│   │   │   └── i18n/               # French translations
│   │   └── CLAUDE.md
│   │
│   └── mobile/                     # React Native (Expo)
│       ├── src/
│       │   ├── screens/
│       │   ├── components/
│       │   ├── stores/
│       │   ├── services/
│       │   │   └── offline-queue.ts
│       │   └── i18n/
│       └── CLAUDE.md
│
├── packages/
│   └── pdf-service/                    # Python PDF microservice
│       ├── Dockerfile
│       ├── requirements.txt            # flask, reportlab, gunicorn
│       ├── app.py                      # Flask app: POST /generate
│       ├── templates/                  # Jinja2 + ReportLab templates per doc type
│       │   ├── offer.py
│       │   ├── invoice.py
│       │   └── meeting_pv.py
│       └── fonts/                      # Noto Sans for French accented chars
│
└── infrastructure/
    ├── supabase/                   # Supabase project config
    ├── railway/                    # Railway service configs
    └── terraform/                  # If needed for AWS resources
```

### 3.2 Why This Structure

| Decision | Reason |
|----------|--------|
| **Turborepo monorepo** | Shared types, single CI, atomic changes across API+Web |
| **`packages/shared`** | Contracts, types, and utils used by API, Web, and Mobile — single source of truth |
| **Module-per-directory in API** | Each module is self-contained: entity, service, controller, DTOs, tests. Claude Code works on one at a time. |
| **Route-based splitting in Web** | Each page group loads independently. Matches module boundaries. |
| **`packages/db` separate** | Migrations, RLS policies, and seeds live together. API imports types from shared, not from db. |

---

## 4. Build Phases & Ordering

### Phase 0: Foundation (Week 1)

**What we build:**
- Monorepo skeleton with Turborepo
- Database connection and migration tooling
- Auth module (Supabase Auth integration)
- Core tables: `company`, `user`, `audit_log`
- RLS policies for core tables
- JWT guard, roles guard, company context guard
- Global exception filter, response envelope interceptor
- Audit log interceptor
- Health check endpoint
- Frontend: auth pages (login, forgot password), app shell, sidebar, routing

**Info needed from Claude Code:**
- This document (build strategy)
- PRD sections 3 (roles), 5 (architecture), 18 (admin/security)

**Exit criteria:**
- A user can sign in, see the dashboard shell, and the API rejects unauthorized requests
- All RLS policies tested with multiple tenants
- Audit log captures every write operation

---

### Phase 1: CRM, Catalogue & Plans (Week 2)

**What we build:**
- CRM module: clients, contacts, pipeline
- Catalogue module: canonical articles, article aliases, CSV import
- Plans module: PDF/DWG upload, annotation layer, plan↔offer linking
- Price observations from imported data
- Frontend: client list/detail pages, article catalogue browser, plan viewer, CSV import UI

**Info needed:**
- PRD section 9 (CRM), section 7.1-7.3 (catalogue)
- Real CSV sample from the 5 project corpus
- CAN/NPK article structure

**Exit criteria:**
- Import 303 articles via CSV, verify all stored correctly
- Client CRUD with multi-tenant isolation
- Price observations queryable by article with median/min/max

---

### Phase 2: Offer Engine (Weeks 3-4)

**The hardest module. Gets two weeks.**

**What we build:**
- Offer CRUD with versioning
- Offer line editor with 5 pricing strategies
- Room-type profiles and suggestions
- Confidence scoring (4 dimensions)
- Bundle/composed article editor
- Variant system (6 types)
- "Prix à compléter" safety rule
- 100% pricing rule enforcement
- Offer PDF generation
- Frontend: full offer builder UI

**Info needed:**
- PRD section 7 (complete)
- Offer engine spec (GEE_Cahier_des_charges)
- All 287 room-type profiles from corpus
- Business rules JSON

**Exit criteria:**
- Create an offer for a villa project, system suggests articles per room
- All 5 pricing strategies produce correct results
- Cannot finalize an offer with any line at 0 CHF
- Bundle editor correctly calculates composed prices
- PDF generation with all offer data

---

### Phase 3: Contracts & Projects (Week 5)

**What we build:**
- Contract generation from accepted offer
- Amendment tracking
- Project auto-creation from signed contract
- Offer→task transformation (lots + milestones)
- Gantt chart (frontend) with dependencies
- Resource assignment
- Frontend: contract management, project dashboard, Gantt

**Info needed:**
- PRD sections 8 (contracts), 9 (projects)
- Q34 answer (offer→tasks logic)
- Q16 (signature types — can stub e-signature integration)

**Exit criteria:**
- Accept an offer → contract generated → project created with lots
- Tasks appear grouped by lot with milestone markers
- Gantt renders and allows drag-to-reschedule

---

### Phase 4: Field Operations (Week 6)

**What we build:**
- Task management (assignment, status tracking)
- Timekeeping module (clock in/out, break, project selection)
- Expense tracking (material, travel, per diem, subcontractor, equipment rental)
- Geolocation (optional, per company setting)
- Hour validation workflow (worker → team leader)
- Daily report system
- Frontend: task board, timekeeping interface, expense forms, daily reports

**Info needed:**
- PRD sections 10 (tasks/timekeeping), 11 (meetings)
- Q17 (geolocation), Q32 (travel time), Q35 (overtime)

**Exit criteria:**
- Worker clocks in on mobile, selects project, clocks out
- Team leader sees pending hours, approves them
- Overtime hours calculated per CCT rules
- Travel time recorded separately

---

### Phase 5: HR & Procurement (Week 7)

**What we build:**
- Employee management (full CRUD, hourly rate, CCT, overtime account)
- Team management (create teams, assign workers)
- Purchase orders and supplier management
- Delivery tracking
- Site meeting module (PV generation)
- Stock module (simple inventory + movements)
- Frontend: HR pages, procurement workflow, stock management

**Info needed:**
- PRD sections 12 (procurement), 13 (stock), 14 (HR), 11 (meetings)
- Q29 (retention), Q31 (subcontractor margin)

**Exit criteria:**
- Full employee lifecycle: create → assign to team → assign to project → deactivate
- Purchase order → delivery received → stock updated
- Meeting PV generated with action items

---

### Phase 6: Invoicing & Accounting (Weeks 8-9)

**Another critical module. Two weeks.**

**What we build:**
- Invoice generation (5 types: standard, situation, acompte, credit note, final)
- Sequential gapless numbering
- VAT calculation (8.1% default, modifiable)
- Swiss 5ct rounding on all amounts
- Situation logic (quantities executed, deduct prior acomptes)
- Plus-value detection and management
- Retention (5%) hold and release
- Invoice PDF generation
- Accounting module: chart of accounts, journal entries, ledger
- Fiduciary export (3 CSV files)
- Financial alerts (plus-value, drift, acompte)
- Frontend: invoice builder, accounting dashboard, fiduciary export UI

**Info needed:**
- PRD sections 15 (invoicing), 16 (accounting), 17 (fiduciary export)
- Q20 (numbering), Q21 (VAT), Q23 (margin), Q28 (situations), Q30 (acomptes)
- Fiduciary export spec (project doc)

**Exit criteria:**
- Create invoice → sequential number assigned → cannot delete → only credit note
- Situation correctly deducts all prior acomptes
- 5ct rounding verified on every monetary output
- Fiduciary CSV exports match spec exactly (encoding, delimiters, columns)
- Financial drift alert fires when costs exceed budget by >10%
- Expense data flows correctly into Fiduciary Export

---

### Phase 7: Admin, AI, Portal & Subscription (Week 10)

**What we build:**
- Company settings (logo, document templates, module toggles)
- Subscription management (Stripe integration: plans, seats, billing events)
- Data retention enforcement (10-year rule, anonymization after 90 days)
- Data export (LPD/GDPR compliance)
- AI chatbot integration (support bot)
- AI offer suggestions enhancement
- Client portal (token-based read-only access)
- Frontend: admin settings, subscription/billing pages, AI chat, portal pages

**Info needed:**
- PRD sections 18 (admin), 21 (portal), 22 (AI), 25 (data retention)
- Data retention policy doc

**Exit criteria:**
- Admin can configure company, manage users, export all data
- Deactivated user's data retained, licence freed
- Client portal shows correct project info via token URL
- AI chatbot answers basic OXACAN usage questions

---

### Phase 8: Mobile App (Weeks 11-12)

**What we build:**
- React Native app with Expo
- Offline queue (Option B: queue writes, block edits)
- Sync engine (automatic on reconnection)
- Worker screens: clock in/out, tasks, daily report, material usage, signature
- Team leader screens: task distribution, hour validation, meeting PV
- Push notifications (shift reminders, task assignments)

**Info needed:**
- PRD section 20 (mobile)
- Offline mode spec (Option B)

**Exit criteria:**
- Worker can clock in offline, sync when online
- Team leader approves hours on mobile
- No data loss during offline→online transitions
- Correct conflict resolution

---

### Phase 9: Integration Testing, Security Audit, Polish (Weeks 13-14)

**What we build:**
- End-to-end tests for the complete flow: Plan → Offer → Contract → Project → Tasks → Timekeeping → Invoice → Accounting
- Security audit: penetration testing, RLS verification, OWASP top 10
- Performance testing: 200-line offer generation < 10s
- UI polish: loading states, error states, empty states
- Accessibility basics (contrast, keyboard navigation)
- Documentation: user guide, admin guide

**Exit criteria:**
- Full flow works end-to-end without manual intervention
- Zero critical/high security findings
- Performance targets met
- No unhandled error states in UI

---

## 5. Complete Database Schema

### 5.1 Design Principles

| Principle | Implementation |
|-----------|----------------|
| **Multi-tenant** | Every table has `company_id UUID NOT NULL`, enforced by RLS |
| **Money as integers** | All CHF amounts stored as integer centimes. `12345` = 123.45 CHF |
| **Soft delete** | `deactivated_at TIMESTAMPTZ NULL` instead of deletion for users |
| **Immutable records** | `source_occurrence`, emitted invoices, journal entries — never updated |
| **Audit trail** | `created_at`, `updated_at`, `created_by`, `updated_by` on every table |
| **UUIDs** | `id UUID DEFAULT gen_random_uuid()` as primary key everywhere |
| **Gapless sequences** | Invoices use `advisory lock + SELECT MAX` pattern, not Postgres SERIAL |
| **ORM** | TypeORM throughout (entities, repositories, QueryBuilder). No Prisma. |

### 5.2 Schema Overview (All Tables)

#### Core Domain

```sql
-- Company (tenant)
CREATE TABLE company (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  legal_name TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  postal_code TEXT,
  city TEXT,
  canton TEXT,
  country TEXT DEFAULT 'CH',
  vat_number TEXT,                         -- CHE-xxx.xxx.xxx
  phone TEXT,
  email TEXT,
  website TEXT,
  logo_url TEXT,
  default_vat_rate INTEGER DEFAULT 810,    -- 8.10% as basis points (810 = 8.10%)
  default_margin_factor INTEGER DEFAULT 120, -- 1.20 as percentage×100
  default_retention_rate INTEGER DEFAULT 500, -- 5.00% as basis points
  geolocation_enabled BOOLEAN DEFAULT FALSE,
  subscription_tier TEXT CHECK (tier IN ('solo', 'equipe', 'entreprise')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- User / Employee
CREATE TABLE app_user (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES company(id),
  supabase_auth_id UUID UNIQUE,           -- Links to Supabase Auth
  email TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL CHECK (role IN ('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER', 'WORKER')),
  licence_tier TEXT NOT NULL CHECK (licence_tier IN ('saas', 'application')),
  hourly_rate_cents INTEGER,              -- CHF centimes per hour (overhead included)
  cct_code TEXT,                          -- Applicable collective agreement
  overtime_balance_minutes INTEGER DEFAULT 0,
  hire_date DATE,
  qualifications JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT TRUE,
  deactivated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, email)
);

-- Team
CREATE TABLE team (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES company(id),
  name TEXT NOT NULL,
  leader_id UUID REFERENCES app_user(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE team_member (
  team_id UUID NOT NULL REFERENCES team(id),
  user_id UUID NOT NULL REFERENCES app_user(id),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);

-- Audit log (append-only)
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  user_id UUID,
  action TEXT NOT NULL,                    -- CREATE, UPDATE, DELETE, LOGIN, EXPORT, etc.
  entity_type TEXT NOT NULL,               -- 'invoice', 'offer', 'user', etc.
  entity_id UUID,
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- No UPDATE or DELETE allowed on audit_log (enforced by RLS + trigger)
```

#### CRM Domain

```sql
CREATE TABLE client (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES company(id),
  type TEXT CHECK (type IN ('maitre_ouvrage', 'promoteur', 'architecte', 'ingenieur', 'entreprise_generale', 'collectivite_publique', 'other')),
  name TEXT NOT NULL,
  contact_person TEXT,
  email TEXT,
  phone TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  postal_code TEXT,
  city TEXT,
  canton TEXT,
  country TEXT DEFAULT 'CH',
  notes TEXT,
  pipeline_stage TEXT DEFAULT 'prospect' CHECK (pipeline_stage IN ('prospect', 'qualified', 'active', 'inactive', 'archived')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE client_contact (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES client(id),
  company_id UUID NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  role TEXT,
  email TEXT,
  phone TEXT,
  is_primary BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE client_interaction (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES client(id),
  company_id UUID NOT NULL,
  user_id UUID REFERENCES app_user(id),
  type TEXT CHECK (type IN ('call', 'email', 'meeting', 'note')),
  subject TEXT,
  body TEXT,
  interaction_date TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Plans Domain

```sql
CREATE TABLE plan (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES company(id),
  project_id UUID REFERENCES project(id),
  offer_id UUID REFERENCES offer(id),
  name TEXT NOT NULL,
  file_url TEXT NOT NULL,                  -- Supabase Storage path
  file_type TEXT NOT NULL CHECK (file_type IN ('pdf', 'dwg', 'dxf', 'png', 'jpg')),
  file_size_bytes INTEGER,
  version INTEGER DEFAULT 1,
  scale TEXT,                              -- e.g. '1:50', '1:100'
  floor TEXT,                              -- e.g. 'RDC', '1er étage'
  uploaded_by UUID REFERENCES app_user(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE plan_annotation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES plan(id) ON DELETE CASCADE,
  company_id UUID NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('pin', 'rectangle', 'polygon', 'text', 'measurement')),
  geometry JSONB NOT NULL,                 -- {x, y, width, height} or [{x,y}...]
  label TEXT,
  color TEXT DEFAULT '#FF0000',
  linked_offer_line_id UUID REFERENCES offer_line(id),
  created_by UUID REFERENCES app_user(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Catalogue Domain

```sql
CREATE TABLE canonical_article (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES company(id),
  npk_number TEXT,                         -- NULL for non-CAN articles
  description TEXT NOT NULL,
  unit TEXT NOT NULL,                      -- pce, m, m2, m3, kg, h, fft, etc.
  category TEXT,                           -- electrical, plumbing, etc.
  is_composed BOOLEAN DEFAULT FALSE,
  composed_components JSONB,               -- [{article_id, quantity, unit_price_cents}]
  median_price_cents INTEGER,
  min_price_cents INTEGER,
  max_price_cents INTEGER,
  observation_count INTEGER DEFAULT 0,
  last_price_date DATE,
  confidence_classification REAL DEFAULT 0, -- 0.0 to 1.0
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE article_alias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_article_id UUID NOT NULL REFERENCES canonical_article(id),
  company_id UUID NOT NULL,
  alias_text TEXT NOT NULL,
  source TEXT,                             -- 'import', 'manual', 'ai_match'
  match_confidence REAL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE source_document (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES company(id),
  hash_sha256 TEXT NOT NULL,
  filename TEXT NOT NULL,
  project_name TEXT,
  project_year INTEGER,
  entrepreneur_name TEXT,
  document_type TEXT DEFAULT 'soumission',
  import_date TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'imported' CHECK (status IN ('imported', 'processing', 'matched', 'validated', 'error')),
  total_occurrences INTEGER DEFAULT 0,
  matched_occurrences INTEGER DEFAULT 0,
  imported_by UUID REFERENCES app_user(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, hash_sha256)
);

-- IMMUTABLE after creation
CREATE TABLE source_occurrence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_document_id UUID NOT NULL REFERENCES source_document(id),
  company_id UUID NOT NULL,
  line_number INTEGER,
  raw_text TEXT NOT NULL,
  npk_number TEXT,
  description TEXT,
  unit TEXT,
  quantity REAL,
  unit_price_cents INTEGER,
  total_price_cents INTEGER,
  room_type TEXT,
  floor TEXT,
  status TEXT DEFAULT 'unmatched' CHECK (status IN ('unmatched', 'auto_matched', 'manual_matched', 'confirmed', 'rejected')),
  canonical_article_id UUID REFERENCES canonical_article(id),
  match_confidence REAL,
  created_at TIMESTAMPTZ DEFAULT NOW()
  -- NO updated_at — immutable
);

CREATE TABLE price_observation (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_article_id UUID NOT NULL REFERENCES canonical_article(id),
  company_id UUID NOT NULL,
  source_occurrence_id UUID REFERENCES source_occurrence(id),
  unit_price_cents INTEGER NOT NULL,
  observation_date DATE NOT NULL,
  project_name TEXT,
  project_type TEXT,
  is_outlier BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE room_type (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  name TEXT NOT NULL,                      -- 'local_technique', 'cuisine', etc.
  description TEXT,
  typical_articles JSONB DEFAULT '[]',
  project_count INTEGER DEFAULT 0,
  occurrence_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE project_type (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  name TEXT NOT NULL,                      -- 'villa', 'immeuble', 'renovation', etc.
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE business_rule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  canonical_article_id UUID NOT NULL REFERENCES canonical_article(id),
  room_type_id UUID REFERENCES room_type(id),
  project_type_id UUID REFERENCES project_type(id),
  suggested_quantity REAL,
  confidence REAL DEFAULT 0,
  source TEXT CHECK (source IN ('statistical', 'manual', 'ai_suggested')),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Offer Domain

```sql
CREATE TABLE offer (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES company(id),
  client_id UUID NOT NULL REFERENCES client(id),
  project_name TEXT NOT NULL,
  project_type_id UUID REFERENCES project_type(id),
  reference TEXT,                          -- Company's internal reference
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'submitted', 'accepted', 'rejected', 'archived')),
  version INTEGER DEFAULT 1,
  margin_factor INTEGER DEFAULT 120,       -- 120 = 1.20x
  total_ht_cents INTEGER DEFAULT 0,        -- Total before tax
  total_vat_cents INTEGER DEFAULT 0,
  total_ttc_cents INTEGER DEFAULT 0,       -- Total with tax
  vat_rate INTEGER DEFAULT 810,            -- 8.10% as basis points
  validity_days INTEGER DEFAULT 30,
  notes TEXT,
  submitted_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  created_by UUID REFERENCES app_user(id),
  updated_by UUID REFERENCES app_user(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE offer_line (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id UUID NOT NULL REFERENCES offer(id) ON DELETE CASCADE,
  company_id UUID NOT NULL,
  canonical_article_id UUID REFERENCES canonical_article(id),
  position_number INTEGER NOT NULL,        -- Ordering within the offer
  description TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit_price_cents INTEGER,                -- NULL = "prix à compléter"
  total_price_cents INTEGER,
  pricing_strategy TEXT CHECK (pricing_strategy IN ('LATEST', 'MEDIAN_N', 'INDEXED', 'COMPOSED', 'MANUAL')),
  confidence_score REAL,
  room_type TEXT,
  variant_type TEXT DEFAULT 'BASE' CHECK (variant_type IN ('BASE', 'VARIANTE', 'OPTION', 'HYPOTHESE_A_VALIDER', 'INFORMATION_MANQUANTE', 'EXCLU')),
  is_priced BOOLEAN GENERATED ALWAYS AS (unit_price_cents IS NOT NULL) STORED,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE offer_assumption (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id UUID NOT NULL REFERENCES offer(id) ON DELETE CASCADE,
  company_id UUID NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('VARIANTE', 'OPTION', 'HYPOTHESE_A_VALIDER', 'INFORMATION_MANQUANTE', 'EXCLU')),
  description TEXT NOT NULL,
  impact_amount_cents INTEGER,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'confirmed', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Contract & Project Domain

```sql
CREATE TABLE contract (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES company(id),
  offer_id UUID NOT NULL REFERENCES offer(id),
  client_id UUID NOT NULL REFERENCES client(id),
  reference TEXT NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'signed', 'active', 'completed', 'terminated')),
  signed_at TIMESTAMPTZ,
  total_ttc_cents INTEGER NOT NULL,
  retention_rate INTEGER DEFAULT 500,      -- 5.00% as basis points
  esignature_provider TEXT DEFAULT 'swisscom', -- Swisscom Trust Services
  esignature_request_id TEXT,              -- External e-signature request ID
  esignature_status TEXT CHECK (esignature_status IN ('none', 'pending', 'signed', 'declined', 'expired')),
  notes TEXT,
  created_by UUID REFERENCES app_user(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE contract_amendment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID NOT NULL REFERENCES contract(id),
  company_id UUID NOT NULL,
  amendment_number INTEGER NOT NULL,
  description TEXT NOT NULL,
  amount_delta_cents INTEGER DEFAULT 0,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'signed')),
  signed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE project (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES company(id),
  contract_id UUID REFERENCES contract(id),
  client_id UUID NOT NULL REFERENCES client(id),
  reference TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT DEFAULT 'planning' CHECK (status IN ('planning', 'active', 'on_hold', 'completed', 'cancelled')),
  start_date DATE,
  end_date DATE,
  budget_ht_cents INTEGER,
  actual_cost_cents INTEGER DEFAULT 0,
  progress_percent INTEGER DEFAULT 0,
  address TEXT,
  postal_code TEXT,
  city TEXT,
  latitude REAL,
  longitude REAL,
  manager_id UUID REFERENCES app_user(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE project_lot (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES project(id),
  company_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  budget_cents INTEGER,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE project_milestone (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES project(id),
  lot_id UUID REFERENCES project_lot(id),
  company_id UUID NOT NULL,
  name TEXT NOT NULL,
  target_date DATE,
  completed_date DATE,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'overdue')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Task Domain

```sql
CREATE TABLE task (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES project(id),
  lot_id UUID REFERENCES project_lot(id),
  company_id UUID NOT NULL,
  parent_task_id UUID REFERENCES task(id),
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done', 'validated', 'cancelled')),
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  planned_start DATE,
  planned_end DATE,
  actual_start DATE,
  actual_end DATE,
  estimated_hours REAL,
  actual_hours REAL DEFAULT 0,
  progress_percent INTEGER DEFAULT 0,
  assigned_to UUID REFERENCES app_user(id),
  created_by UUID REFERENCES app_user(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE task_dependency (
  predecessor_id UUID NOT NULL REFERENCES task(id),
  successor_id UUID NOT NULL REFERENCES task(id),
  type TEXT DEFAULT 'finish_to_start' CHECK (type IN ('finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish')),
  lag_days INTEGER DEFAULT 0,
  PRIMARY KEY (predecessor_id, successor_id)
);

CREATE TABLE task_comment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES task(id),
  company_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES app_user(id),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE task_attachment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES task(id),
  company_id UUID NOT NULL,
  filename TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  uploaded_by UUID REFERENCES app_user(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Timekeeping Domain

```sql
CREATE TABLE time_entry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES app_user(id),
  project_id UUID NOT NULL REFERENCES project(id),
  task_id UUID REFERENCES task(id),
  date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME,
  break_minutes INTEGER DEFAULT 0,
  normal_minutes INTEGER,                  -- Computed
  overtime_minutes INTEGER DEFAULT 0,
  travel_minutes INTEGER DEFAULT 0,
  total_minutes INTEGER,                   -- Computed
  hourly_rate_cents INTEGER,               -- Snapshot of rate at time of entry
  cost_cents INTEGER,                      -- total_minutes/60 × hourly_rate_cents
  category TEXT DEFAULT 'normal' CHECK (category IN ('normal', 'overtime', 'travel', 'absence')),
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  approved_by UUID REFERENCES app_user(id),
  approved_at TIMESTAMPTZ,
  latitude REAL,
  longitude REAL,
  notes TEXT,
  is_offline_entry BOOLEAN DEFAULT FALSE,
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE expense (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES app_user(id),
  project_id UUID REFERENCES project(id),
  task_id UUID REFERENCES task(id),
  date DATE NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('material', 'travel', 'per_diem', 'subcontractor', 'equipment_rental', 'other')),
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  receipt_url TEXT,                         -- Supabase Storage path
  is_billable BOOLEAN DEFAULT FALSE,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
  approved_by UUID REFERENCES app_user(id),
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE daily_report (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES app_user(id),
  project_id UUID NOT NULL REFERENCES project(id),
  date DATE NOT NULL,
  work_description TEXT,
  materials_used JSONB DEFAULT '[]',
  weather TEXT,
  temperature_celsius REAL,
  notes TEXT,
  photos JSONB DEFAULT '[]',               -- [{url, caption}]
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, user_id, project_id, date)
);
```

#### Procurement & Stock Domain

```sql
CREATE TABLE supplier (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES company(id),
  name TEXT NOT NULL,
  contact_person TEXT,
  email TEXT,
  phone TEXT,
  address TEXT,
  payment_terms_days INTEGER DEFAULT 30,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE purchase_order (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  supplier_id UUID NOT NULL REFERENCES supplier(id),
  project_id UUID REFERENCES project(id),
  reference TEXT NOT NULL,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'confirmed', 'partially_delivered', 'delivered', 'cancelled')),
  total_ht_cents INTEGER DEFAULT 0,
  ordered_at TIMESTAMPTZ,
  expected_delivery DATE,
  created_by UUID REFERENCES app_user(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE purchase_order_line (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id UUID NOT NULL REFERENCES purchase_order(id) ON DELETE CASCADE,
  company_id UUID NOT NULL,
  canonical_article_id UUID REFERENCES canonical_article(id),
  description TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit TEXT NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  total_price_cents INTEGER NOT NULL,
  delivered_quantity REAL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE stock_location (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  name TEXT NOT NULL,                      -- 'Dépôt principal', 'Véhicule X', etc.
  type TEXT CHECK (type IN ('warehouse', 'vehicle', 'site')),
  address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE stock_item (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  canonical_article_id UUID NOT NULL REFERENCES canonical_article(id),
  location_id UUID NOT NULL REFERENCES stock_location(id),
  quantity REAL NOT NULL DEFAULT 0,
  min_threshold REAL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, canonical_article_id, location_id)
);

CREATE TABLE stock_movement (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  stock_item_id UUID NOT NULL REFERENCES stock_item(id),
  type TEXT NOT NULL CHECK (type IN ('in', 'out', 'transfer', 'adjustment')),
  quantity REAL NOT NULL,
  from_location_id UUID REFERENCES stock_location(id),
  to_location_id UUID REFERENCES stock_location(id),
  project_id UUID REFERENCES project(id),
  reference TEXT,                          -- PO reference, manual reason, etc.
  performed_by UUID REFERENCES app_user(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE vehicle (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  registration TEXT NOT NULL,
  make TEXT,
  model TEXT,
  assigned_team_id UUID REFERENCES team(id),
  assigned_project_id UUID REFERENCES project(id),
  insurance_expiry DATE,
  next_service_date DATE,
  odometer_km INTEGER,
  stock_location_id UUID REFERENCES stock_location(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Invoicing Domain

```sql
CREATE TABLE invoice (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES company(id),
  project_id UUID NOT NULL REFERENCES project(id),
  client_id UUID NOT NULL REFERENCES client(id),
  type TEXT NOT NULL CHECK (type IN ('invoice', 'situation', 'acompte', 'credit_note', 'final_invoice')),
  invoice_number TEXT NOT NULL,            -- Gapless sequential: '2026-001'
  reference_invoice_id UUID REFERENCES invoice(id), -- For credit notes
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'paid', 'partially_paid', 'overdue', 'cancelled')),
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  vat_rate INTEGER NOT NULL,               -- Basis points: 810 = 8.10%
  subtotal_ht_cents INTEGER NOT NULL DEFAULT 0,
  vat_amount_cents INTEGER NOT NULL DEFAULT 0,
  retention_amount_cents INTEGER DEFAULT 0, -- 5% retention hold
  prior_acomptes_cents INTEGER DEFAULT 0,  -- Sum of prior acomptes to deduct
  total_ttc_cents INTEGER NOT NULL DEFAULT 0,
  amount_paid_cents INTEGER DEFAULT 0,
  notes TEXT,
  payment_terms TEXT,
  pdf_url TEXT,
  sent_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_by UUID REFERENCES app_user(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, invoice_number)
);

CREATE TABLE invoice_line (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoice(id) ON DELETE CASCADE,
  company_id UUID NOT NULL,
  description TEXT NOT NULL,
  unit TEXT,
  quantity REAL NOT NULL,
  unit_price_cents INTEGER NOT NULL,
  total_price_cents INTEGER NOT NULL,
  -- For situations: track quantities executed
  cumulative_quantity REAL,                -- Total quantity executed to date
  previous_quantity REAL,                  -- Quantity already billed
  period_quantity REAL,                    -- This period = cumulative - previous
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE plus_value (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES project(id),
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT DEFAULT 'detected' CHECK (status IN ('detected', 'submitted', 'approved', 'rejected', 'invoiced')),
  approved_by_client BOOLEAN DEFAULT FALSE,
  approved_at TIMESTAMPTZ,
  invoice_id UUID REFERENCES invoice(id),
  created_by UUID REFERENCES app_user(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Accounting Domain

```sql
CREATE TABLE chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES company(id),
  account_number TEXT NOT NULL,            -- Swiss standard: '1000', '1100', etc.
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  parent_id UUID REFERENCES chart_of_accounts(id),
  is_system BOOLEAN DEFAULT FALSE,        -- Cannot be deleted
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, account_number)
);

CREATE TABLE journal_entry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES company(id),
  entry_number INTEGER NOT NULL,
  entry_date DATE NOT NULL,
  description TEXT NOT NULL,
  reference_type TEXT,                     -- 'invoice', 'payment', 'manual', etc.
  reference_id UUID,                       -- ID of the source document
  is_posted BOOLEAN DEFAULT FALSE,
  posted_at TIMESTAMPTZ,
  posted_by UUID REFERENCES app_user(id),
  created_by UUID REFERENCES app_user(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(company_id, entry_number)
  -- IMMUTABLE once posted
);

CREATE TABLE journal_entry_line (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id UUID NOT NULL REFERENCES journal_entry(id),
  company_id UUID NOT NULL,
  account_id UUID NOT NULL REFERENCES chart_of_accounts(id),
  debit_cents INTEGER DEFAULT 0,
  credit_cents INTEGER DEFAULT 0,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE payment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  invoice_id UUID NOT NULL REFERENCES invoice(id),
  amount_cents INTEGER NOT NULL,
  payment_date DATE NOT NULL,
  payment_method TEXT CHECK (payment_method IN ('bank_transfer', 'card', 'cash', 'other')),
  reference TEXT,
  journal_entry_id UUID REFERENCES journal_entry(id),
  created_by UUID REFERENCES app_user(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Subscription & Billing Domain

```sql
CREATE TABLE subscription (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES company(id) UNIQUE,
  stripe_customer_id TEXT NOT NULL,
  stripe_subscription_id TEXT,
  tier TEXT NOT NULL CHECK (tier IN ('solo', 'equipe', 'entreprise')),
  status TEXT NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled', 'paused')),
  saas_seat_count INTEGER DEFAULT 1,
  application_seat_count INTEGER DEFAULT 0,
  trial_ends_at TIMESTAMPTZ,
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE billing_event (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES company(id),
  subscription_id UUID NOT NULL REFERENCES subscription(id),
  type TEXT NOT NULL CHECK (type IN ('payment_succeeded', 'payment_failed', 'tier_changed', 'seat_added', 'seat_removed', 'trial_ended', 'subscription_cancelled')),
  stripe_event_id TEXT UNIQUE,
  amount_cents INTEGER,
  currency TEXT DEFAULT 'CHF',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Site Meeting Domain

```sql
CREATE TABLE site_meeting (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES project(id),
  meeting_number INTEGER NOT NULL,
  meeting_date TIMESTAMPTZ NOT NULL,
  location TEXT,
  agenda TEXT,
  minutes TEXT,                            -- PV content
  status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'completed')),
  pdf_url TEXT,
  created_by UUID REFERENCES app_user(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE meeting_attendee (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES site_meeting(id),
  company_id UUID NOT NULL,
  name TEXT NOT NULL,
  role TEXT,
  organization TEXT,
  attendance TEXT DEFAULT 'present' CHECK (attendance IN ('present', 'absent', 'excused')),
  signature_url TEXT
);

CREATE TABLE meeting_action (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES site_meeting(id),
  company_id UUID NOT NULL,
  description TEXT NOT NULL,
  responsible TEXT NOT NULL,
  due_date DATE,
  status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'done', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### Portal & Notifications

```sql
CREATE TABLE portal_token (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  project_id UUID NOT NULL REFERENCES project(id),
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES app_user(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE push_device (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES app_user(id),
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  device_token TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  last_used_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, device_token)
);

CREATE TABLE notification (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES app_user(id),
  type TEXT NOT NULL,                      -- 'task_assigned', 'hours_to_approve', 'invoice_overdue', etc.
  title TEXT NOT NULL,
  body TEXT,
  reference_type TEXT,
  reference_id UUID,
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  push_sent BOOLEAN DEFAULT FALSE,
  push_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE idempotency_key (
  key TEXT NOT NULL,
  company_id UUID NOT NULL,
  response_status INTEGER,
  response_body JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
  PRIMARY KEY (key, company_id)
);
-- Scheduled cleanup: DELETE FROM idempotency_key WHERE expires_at < NOW()

CREATE TABLE data_export_request (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES company(id),
  requested_by UUID NOT NULL REFERENCES app_user(id),
  type TEXT NOT NULL CHECK (type IN ('full_export', 'accounting_export', 'gdpr_export')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  scope JSONB DEFAULT '{}',                -- Which entities/date ranges
  download_url TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE anonymization_job (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES company(id),
  entity_type TEXT NOT NULL,               -- 'client', 'user', etc.
  entity_id UUID NOT NULL,
  scheduled_for TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 5.3 Indexes

```sql
-- Performance-critical indexes
CREATE INDEX idx_time_entry_user_date ON time_entry(company_id, user_id, date);
CREATE INDEX idx_time_entry_project ON time_entry(company_id, project_id, date);
CREATE INDEX idx_offer_line_offer ON offer_line(offer_id);
CREATE INDEX idx_invoice_project ON invoice(company_id, project_id);
CREATE INDEX idx_invoice_number ON invoice(company_id, invoice_number);
CREATE INDEX idx_price_observation_article ON price_observation(company_id, canonical_article_id, observation_date);
CREATE INDEX idx_source_occurrence_document ON source_occurrence(source_document_id);
CREATE INDEX idx_task_project ON task(company_id, project_id);
CREATE INDEX idx_audit_log_entity ON audit_log(company_id, entity_type, entity_id);
CREATE INDEX idx_notification_user_unread ON notification(company_id, user_id) WHERE is_read = FALSE;
CREATE INDEX idx_stock_item_lookup ON stock_item(company_id, canonical_article_id, location_id);
CREATE INDEX idx_journal_entry_date ON journal_entry(company_id, entry_date);

-- Plan & annotation indexes
CREATE INDEX idx_plan_project ON plan(company_id, project_id);
CREATE INDEX idx_plan_offer ON plan(company_id, offer_id);
CREATE INDEX idx_plan_annotation_plan ON plan_annotation(plan_id);

-- Expense indexes
CREATE INDEX idx_expense_user_date ON expense(company_id, user_id, date);
CREATE INDEX idx_expense_project ON expense(company_id, project_id);
CREATE INDEX idx_expense_status ON expense(company_id, status) WHERE status IN ('submitted');

-- Push device index
CREATE INDEX idx_push_device_user ON push_device(user_id, is_active) WHERE is_active = TRUE;

-- Idempotency key cleanup index
CREATE INDEX idx_idempotency_expires ON idempotency_key(expires_at);

-- Data retention indexes
CREATE INDEX idx_anonymization_scheduled ON anonymization_job(scheduled_at) WHERE status = 'pending';
CREATE INDEX idx_data_export_user ON data_export_request(company_id, user_id);

-- Subscription index
CREATE INDEX idx_subscription_company ON subscription(company_id);
CREATE INDEX idx_billing_event_subscription ON billing_event(subscription_id, event_date);
```

### 5.4 Dual-Layer Tenant Isolation

OXACAN uses a **dual-layer** approach to multi-tenant isolation:

| Layer | Mechanism | Role |
|-------|-----------|------|
| **Primary** | Application-level `CompanyContextGuard` + TypeORM query filtering | Enforces `company_id` on every query via NestJS guard |
| **Safety Net** | PostgreSQL RLS with `SET LOCAL` session variables | Catches any query that bypasses the application layer |

#### Layer 1: Application Guard (Primary)

```typescript
// guards/company-context.guard.ts
@Injectable()
export class CompanyContextGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user; // from JWT
    request.companyId = user.companyId;
    request.userId = user.id;
    request.userRole = user.role;
    return true;
  }
}

// Every repository method includes company_id:
async findAll(companyId: string): Promise<Client[]> {
  return this.clientRepo.find({ where: { companyId } });
}
```

#### Layer 2: RLS Safety Net

Before every request, the API sets PostgreSQL session variables:

```typescript
// middleware/rls-context.middleware.ts
@Injectable()
export class RlsContextMiddleware implements NestMiddleware {
  constructor(private dataSource: DataSource) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.query(`SELECT set_config('app.company_id', $1, true)`, [req.companyId]);
    await queryRunner.query(`SELECT set_config('app.user_id', $1, true)`, [req.userId]);
    await queryRunner.query(`SELECT set_config('app.user_role', $1, true)`, [req.userRole]);
    // Attach queryRunner to request for use in the request lifecycle
    req.queryRunner = queryRunner;
    next();
  }
}
```

RLS policies use these session variables:

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;

-- Tenant isolation via session variable (safety net)
CREATE POLICY "tenant_isolation" ON <table>
  FOR ALL
  USING (company_id = current_setting('app.company_id', true)::uuid);

-- Role-based: workers see only their own assignments
CREATE POLICY "role_based_access" ON time_entry
  FOR SELECT
  USING (
    company_id = current_setting('app.company_id', true)::uuid
    AND (
      user_id = current_setting('app.user_id', true)::uuid
      OR current_setting('app.user_role', true) IN ('ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER')
    )
  );

-- Audit log: insert only, no updates or deletes
CREATE POLICY "audit_log_insert_only" ON audit_log
  FOR INSERT
  WITH CHECK (TRUE);
-- No SELECT/UPDATE/DELETE policies = read via service role only
```

> **Why dual-layer?** The application guard is fast and testable. RLS is a defense-in-depth safety net — if a developer forgets to pass `companyId` in a new query, RLS blocks the leak. Both layers must agree.

---

## 6. Backend Architecture

### 6.1 NestJS Module Pattern

Every module follows this structure:

```
modules/invoicing/
├── invoicing.module.ts       # Module declaration
├── invoicing.service.ts      # Business logic (never in controller)
├── invoicing.controller.ts   # HTTP endpoints (thin — delegates to service)
├── dto/
│   ├── create-invoice.dto.ts # Input validation (class-validator)
│   ├── update-invoice.dto.ts
│   └── invoice-query.dto.ts  # Query/filter parameters
├── entities/
│   └── invoice.entity.ts     # TypeORM entity (maps to DB table)
├── events/
│   └── invoice-created.event.ts # Domain events
├── guards/
│   └── invoice-access.guard.ts  # Module-specific auth rules
└── __tests__/
    ├── invoicing.service.spec.ts
    └── invoicing.e2e-spec.ts
```

### 6.2 Global Middleware Stack

```
Request
  → Rate limiter (per IP + per user)
  → CORS (whitelist frontend origins)
  → Helmet (security headers)
  → JWT Auth Guard (verify token, extract user)
  → Company Context Guard (set company_id from user)
  → Roles Guard (check role has access to this endpoint)
  → Validation Pipe (class-validator on DTOs)
  → Controller → Service → Database
  → Audit Log Interceptor (log the action)
  → Response Envelope Interceptor (wrap in {data, meta})
  → Performance Interceptor (log slow queries)
  → Global Exception Filter (catch all, format error)
Response
```

### 6.3 Service Pattern

```typescript
@Injectable()
export class InvoicingService {
  constructor(
    @InjectRepository(Invoice) private invoiceRepo: Repository<Invoice>,
    private readonly companyContext: CompanyContextService,
    private readonly auditService: AuditService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async createInvoice(dto: CreateInvoiceDto, userId: string): Promise<Invoice> {
    const companyId = this.companyContext.getCompanyId();
    
    // Business rule: generate gapless number
    const number = await this.generateNextNumber(companyId);
    
    // Business rule: Swiss 5ct rounding
    const totalTtc = swissRound(dto.subtotalHtCents + dto.vatAmountCents);
    
    const invoice = this.invoiceRepo.create({
      ...dto,
      companyId,
      invoiceNumber: number,
      totalTtcCents: totalTtc,
      createdBy: userId,
    });
    
    const saved = await this.invoiceRepo.save(invoice);
    
    // Emit domain event for cross-module reactions
    this.eventEmitter.emit('invoice.created', new InvoiceCreatedEvent(saved));
    
    return saved;
  }

  private async generateNextNumber(companyId: string): Promise<string> {
    // Advisory lock to prevent race conditions
    return this.invoiceRepo.manager.transaction(async (em) => {
      await em.query('SELECT pg_advisory_xact_lock($1)', [hashCode(companyId)]);
      const result = await em.query(
        `SELECT MAX(invoice_number) as max_num FROM invoice WHERE company_id = $1 AND invoice_number LIKE $2`,
        [companyId, `${new Date().getFullYear()}-%`]
      );
      const nextSeq = result[0]?.max_num 
        ? parseInt(result[0].max_num.split('-')[1]) + 1 
        : 1;
      return `${new Date().getFullYear()}-${String(nextSeq).padStart(3, '0')}`;
    });
  }
}
```

### 6.4 Event-Driven Cross-Module Communication

Modules communicate through domain events, not direct imports:

```typescript
// When an offer is accepted → create a contract + project
@OnEvent('offer.accepted')
async handleOfferAccepted(event: OfferAcceptedEvent) {
  await this.contractService.createFromOffer(event.offer);
}

// When an invoice is paid → create journal entry
@OnEvent('invoice.paid')
async handleInvoicePaid(event: InvoicePaidEvent) {
  await this.accountingService.createPaymentEntry(event.invoice, event.payment);
}

// When time entries are approved → update project actual cost
@OnEvent('timeEntry.approved')
async handleTimeApproved(event: TimeEntryApprovedEvent) {
  await this.projectService.updateActualCost(event.projectId);
}
```

### 6.5 PDF Generation Architecture

PDF generation uses a **separate Python/Flask microservice** running on Railway, called via internal HTTP from the NestJS API.

```
┌────────────┐    POST /generate     ┌──────────────────┐     upload      ┌─────────────────┐
│  NestJS API │ ──────────────────── │ pdf-service      │ ──────────────── │ Supabase Storage │
│             │    { type, data }    │ Flask + ReportLab│     PDF file    │  /pdfs/{company} │
│             │ ◄────────────────── │                  │                 │                  │
│             │    { url, size }     │                  │                 │                  │
└────────────┘                       └──────────────────┘                 └─────────────────┘
```

**API contract:**

```typescript
// POST /generate
interface PdfGenerateRequest {
  type: 'offer' | 'invoice' | 'credit_note' | 'meeting_pv' | 'timesheet_report';
  data: Record<string, any>;  // type-specific payload
  company_id: string;
  locale: 'fr';               // V1: French only
}

interface PdfGenerateResponse {
  url: string;        // Supabase Storage signed URL
  file_key: string;   // Storage path for future reference
  size_bytes: number;
  generated_at: string;
}
```

**NestJS client service:**

```typescript
@Injectable()
export class PdfService {
  private readonly baseUrl = process.env.PDF_SERVICE_URL; // Railway internal URL

  async generate(request: PdfGenerateRequest): Promise<PdfGenerateResponse> {
    const response = await firstValueFrom(
      this.httpService.post(`${this.baseUrl}/generate`, request, {
        timeout: 30_000, // 30s timeout for complex PDFs
        headers: { 'X-Internal-Key': process.env.PDF_SERVICE_KEY },
      }),
    );
    return response.data;
  }
}
```

**Why a separate service?** ReportLab is Python-only. Running it in a separate Railway service keeps the NestJS API pure TypeScript and allows independent scaling of PDF generation.

### 6.6 File Storage Architecture

All file uploads use **Supabase Storage** with RLS on buckets.

**Bucket structure:**

| Bucket | Contents | Max File Size |
|--------|----------|---------------|
| `plans` | PDF, DWG, DXF, PNG, JPG plan files | 50 MB |
| `receipts` | Expense receipt photos | 10 MB |
| `attachments` | General project attachments | 25 MB |
| `pdfs` | Generated PDF documents (offers, invoices) | 10 MB |
| `logos` | Company logos | 2 MB |
| `signatures` | Signature images | 1 MB |

**Path convention:** `{company_id}/{bucket}/{entity_id}/{filename}`

```typescript
// Upload pattern
@Injectable()
export class StorageService {
  constructor(private supabase: SupabaseClient) {}

  async upload(
    bucket: string,
    companyId: string,
    entityId: string,
    file: Express.Multer.File,
  ): Promise<{ url: string; path: string }> {
    const path = `${companyId}/${entityId}/${Date.now()}-${file.originalname}`;
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .upload(path, file.buffer, {
        contentType: file.mimetype,
        upsert: false,
      });
    if (error) throw new StorageUploadError(error.message);
    return {
      url: this.supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl,
      path,
    };
  }
}
```

**RLS on storage.objects:**

```sql
CREATE POLICY "tenant_storage_isolation" ON storage.objects
  FOR ALL
  USING (
    bucket_id IN ('plans', 'receipts', 'attachments', 'pdfs', 'logos', 'signatures')
    AND (storage.foldername(name))[1] = current_setting('app.company_id', true)
  );
```

### 6.7 E-Signature Integration (Swisscom Trust Services)

Contracts requiring qualified electronic signatures (QES) integrate with **Swisscom Trust Services**.

```typescript
@Injectable()
export class ESignatureService {
  private readonly apiUrl = process.env.SWISSCOM_AIS_URL;

  async requestSignature(contract: Contract, signerEmail: string): Promise<string> {
    // 1. Generate the PDF to sign
    const pdf = await this.pdfService.generate({
      type: 'offer', // contract PDF based on offer
      data: contract,
      company_id: contract.companyId,
      locale: 'fr',
    });

    // 2. Submit to Swisscom AIS
    const response = await this.httpService.post(`${this.apiUrl}/sign`, {
      document_url: pdf.url,
      signer_email: signerEmail,
      redirect_url: `${process.env.APP_URL}/contracts/${contract.id}/signed`,
    });

    // 3. Update contract status
    await this.contractRepo.update(contract.id, {
      esignatureProvider: 'swisscom_ais',
      esignatureRequestId: response.data.request_id,
      esignatureStatus: 'pending',
    });

    return response.data.signing_url; // URL to send to signer
  }

  async handleWebhook(payload: SwisscomWebhookPayload): Promise<void> {
    const contract = await this.contractRepo.findOne({
      where: { esignatureRequestId: payload.request_id },
    });
    if (!contract) return;

    await this.contractRepo.update(contract.id, {
      esignatureStatus: payload.status, // 'signed' | 'declined' | 'expired'
      status: payload.status === 'signed' ? 'signed' : contract.status,
    });
  }
}
```

---

## 7. Frontend Architecture

### 7.1 Tech Stack

| Library | Purpose |
|---------|---------|
| **React 18** | UI framework |
| **TypeScript** | Type safety |
| **React Router 6** | Routing with lazy loading |
| **Tailwind CSS** | Styling |
| **shadcn/ui** | Component library (accessible, customizable) |
| **Zustand** | State management (light, TypeScript-native) |
| **TanStack Query** | Server state, caching, pagination |
| **React Hook Form + Zod** | Forms with validation |
| **Recharts** | Charts and dashboards |
| **date-fns** | Date formatting (Swiss locale) |

### 7.2 API Client Pattern

```typescript
// lib/api-client.ts
class ApiClient {
  private baseUrl: string;
  private token: string | null;
  
  async request<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
        ...options?.headers,
      },
    });
    
    if (res.status === 401) {
      // Try refresh token
      await this.refreshToken();
      return this.request(endpoint, options); // Retry once
    }
    
    const body = await res.json();
    if (!res.ok) throw new ApiError(body.error);
    return body;
  }
}

// Usage with TanStack Query
function useInvoices(projectId: string) {
  return useQuery({
    queryKey: ['invoices', projectId],
    queryFn: () => api.get<Invoice[]>(`/projects/${projectId}/invoices`),
    staleTime: 30_000,
  });
}
```

### 7.3 Role-Based UI

```typescript
// components/layout/sidebar.tsx
const MENU_ITEMS = [
  { label: 'Tableau de bord', icon: LayoutDashboard, path: '/', roles: ['ALL'] },
  { label: 'Clients', icon: Users, path: '/crm', roles: ['ADMIN', 'PROJECT_MANAGER'] },
  { label: 'Offres', icon: FileText, path: '/offers', roles: ['ADMIN', 'PROJECT_MANAGER'] },
  { label: 'Projets', icon: Building, path: '/projects', roles: ['ADMIN', 'PROJECT_MANAGER'] },
  { label: 'Tâches', icon: CheckSquare, path: '/tasks', roles: ['ALL'] },
  { label: 'Pointage', icon: Clock, path: '/timekeeping', roles: ['ALL'] },
  { label: 'Facturation', icon: Receipt, path: '/invoicing', roles: ['ADMIN', 'PROJECT_MANAGER'] },
  { label: 'Comptabilité', icon: Calculator, path: '/accounting', roles: ['ADMIN'] },
  { label: 'Stock', icon: Package, path: '/stock', roles: ['ADMIN', 'PROJECT_MANAGER', 'TEAM_LEADER'] },
  { label: 'RH', icon: Users, path: '/hr', roles: ['ADMIN'] },
  { label: 'Administration', icon: Settings, path: '/admin', roles: ['ADMIN'] },
];
```

---

## 8. Security Architecture

### 8.1 Threat Model

| Threat | Risk | Mitigation |
|--------|------|------------|
| **Tenant data leakage** | CRITICAL | RLS on every table, tested with cross-tenant queries |
| **JWT theft** | HIGH | Short expiry (15min), httpOnly refresh token, token rotation |
| **SQL injection** | HIGH | Parameterized queries only, TypeORM handles this |
| **XSS** | HIGH | React escapes by default, CSP headers, no dangerouslySetInnerHTML |
| **CSRF** | MEDIUM | SameSite cookies, CSRF token for mutations |
| **Brute force** | MEDIUM | Rate limiting (100 req/min per IP, 10 login attempts per 15 min) |
| **IDOR** | HIGH | Every query filtered by company_id via RLS, never trust client-side IDs |
| **File upload attacks** | MEDIUM | Validate MIME type, virus scan, store in Supabase Storage with RLS |
| **Invoice tampering** | CRITICAL | Immutable once sent, audit log, no DELETE ever |
| **Privilege escalation** | CRITICAL | Role check at guard + service level, never trust client role claim |

### 8.2 Security Checklist (Per Module)

Before marking any module as complete:

- [ ] All queries filtered by `company_id` (tenant isolation)
- [ ] Role guard on every endpoint
- [ ] Input validation with class-validator on every DTO
- [ ] No raw SQL (or if necessary, parameterized)
- [ ] Audit log entry for every write operation
- [ ] Rate limiting on mutation endpoints
- [ ] File uploads validated and scanned
- [ ] Sensitive data not logged (passwords, tokens)
- [ ] Error messages don't leak implementation details
- [ ] Cross-tenant access test written and passing

### 8.3 Authentication Flow

```
Login:
  1. User submits email + password to Supabase Auth
  2. Supabase returns access_token (JWT, 15min) + refresh_token (7 days)
  3. Frontend stores access_token in memory, refresh_token in httpOnly cookie
  4. All API calls include Authorization: Bearer <access_token>
  5. API verifies JWT, extracts supabase_auth_id, looks up app_user → company_id
  6. company_id is set in request context for all downstream queries

Token refresh:
  1. Frontend detects 401 response
  2. Calls /auth/refresh with httpOnly cookie
  3. Supabase issues new access_token + rotates refresh_token
  4. Original request retried with new token

Logout:
  1. Frontend calls /auth/logout
  2. Server invalidates refresh token in Supabase
  3. Frontend clears access_token from memory
```

---

## 9. Observability & Monitoring

### 9.1 Stack

| Tool | Purpose | Region |
|------|---------|--------|
| **Sentry** (Team plan) | Error tracking, performance monitoring | EU data region |
| **PostHog** (EU Cloud) | Product analytics, session replay | EU |
| **Structured logging** | JSON logs with correlation IDs | Railway logs |
| **Health checks** | `/health` endpoint with DB + Storage connectivity (no Redis in stack) | Self |

### 9.2 Logging Strategy

```typescript
// Every request gets a correlation ID
@Injectable()
export class CorrelationIdMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    req.correlationId = req.headers['x-correlation-id'] || randomUUID();
    res.setHeader('x-correlation-id', req.correlationId);
    next();
  }
}

// Structured log format
{
  "timestamp": "2026-10-15T14:32:01.123Z",
  "level": "info",
  "correlationId": "abc-123",
  "userId": "user-456",
  "companyId": "company-789",
  "action": "invoice.created",
  "entityId": "invoice-012",
  "duration_ms": 45,
  "message": "Invoice 2026-001 created"
}
```

### 9.3 Key Metrics to Monitor

| Metric | Alert Threshold | Why |
|--------|-----------------|-----|
| **API p95 latency** | > 2000ms | User experience |
| **Error rate** | > 1% of requests | Something is broken |
| **DB connection pool** | > 80% utilized | About to hit ceiling |
| **RLS policy violation attempts** | Any | Potential attack |
| **Failed login rate** | > 10/min from same IP | Brute force attempt |
| **Invoice creation failures** | Any | Revenue-critical path |
| **Offer generation time** | > 10s for 200 lines | Performance target |
| **Offline sync queue depth** | > 100 entries for any user | Mobile sync issue |

### 9.4 Health Check

```typescript
@Controller('health')
export class HealthController {
  @Get()
  async check() {
    const db = await this.checkDatabase();
    const storage = await this.checkStorage();
    
    return {
      status: db.ok && storage.ok ? 'healthy' : 'degraded',
      version: process.env.APP_VERSION,
      uptime: process.uptime(),
      checks: { db, storage },
      timestamp: new Date().toISOString(),
    };
  }
}
```

---

## 10. Resilience & Error Handling

### 10.1 Error Hierarchy

```typescript
// packages/shared/errors/
export class OxacanError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode: number = 500,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export class ValidationError extends OxacanError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VALIDATION_ERROR', message, 400, details);
  }
}

export class NotFoundError extends OxacanError {
  constructor(entity: string, id: string) {
    super('NOT_FOUND', `${entity} with id ${id} not found`, 404);
  }
}

export class TenantIsolationError extends OxacanError {
  constructor() {
    super('TENANT_VIOLATION', 'Access denied', 403);
    // Log this as CRITICAL — potential security breach
  }
}

export class BusinessRuleError extends OxacanError {
  constructor(rule: string, message: string) {
    super('BUSINESS_RULE', message, 422, { rule });
  }
}

// Usage:
throw new BusinessRuleError('INVOICE_100_PERCENT', 
  'Toutes les lignes doivent être chiffrées avant de finaliser l\'offre');
```

### 10.2 Retry & Circuit Breaker

```typescript
// For external API calls (AI, e-signature, email)
const withRetry = async <T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) throw error;
      await sleep(Math.pow(2, attempt) * 1000); // Exponential backoff
    }
  }
};
```

### 10.3 Database Transaction Patterns

```typescript
// For multi-table writes that must be atomic
async createSituation(dto: CreateSituationDto): Promise<Invoice> {
  return this.dataSource.transaction(async (manager) => {
    // 1. Lock invoice number sequence
    await manager.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);
    
    // 2. Calculate amounts
    const priorAcomptes = await this.sumPriorAcomptes(manager, dto.projectId);
    
    // 3. Create invoice
    const invoice = manager.create(Invoice, {
      ...dto,
      priorAcomptesCents: priorAcomptes,
      totalTtcCents: swissRound(dto.subtotalHtCents + dto.vatAmountCents - priorAcomptes),
    });
    
    // 4. Create journal entry
    const journalEntry = manager.create(JournalEntry, { ... });
    
    // 5. Save both (atomic)
    await manager.save([invoice, journalEntry]);
    
    return invoice;
  });
}
```

### 10.4 Idempotency

For offline mobile sync and webhook handling:

```typescript
// Every mutation from mobile includes an idempotency key
@Post('time-entries')
async createTimeEntry(
  @Headers('x-idempotency-key') idempotencyKey: string,
  @Body() dto: CreateTimeEntryDto,
) {
  // Check if already processed
  const existing = await this.idempotencyService.get(idempotencyKey);
  if (existing) return existing; // Return same response
  
  const result = await this.timekeepingService.create(dto);
  
  // Store result for 24h
  await this.idempotencyService.set(idempotencyKey, result);
  
  return result;
}
```

---

## 11. Testing Strategy

### 11.1 Test Pyramid

| Layer | Count | Scope | Speed |
|-------|-------|-------|-------|
| **Unit tests** | ~300 | Pure functions, business logic, utils | < 1s each |
| **Integration tests** | ~150 | Service + real DB (Supabase local) | < 5s each |
| **E2E API tests** | ~80 | Full HTTP request cycle | < 10s each |
| **E2E UI tests** | ~30 | Critical user flows (Playwright) | < 30s each |

### 11.2 What To Test (Priority)

| Priority | What | Example |
|----------|------|---------|
| **P0** | Money calculations | Swiss rounding, margin, VAT, retention deduction |
| **P0** | Tenant isolation | Company A cannot see Company B's data |
| **P0** | Gapless numbering | Concurrent invoice creation produces no gaps |
| **P0** | Immutability | Cannot UPDATE source_occurrence or posted journal_entry |
| **P1** | Business rules | 100% pricing rule, "prix à compléter" safety |
| **P1** | Auth & roles | Worker cannot access admin endpoints |
| **P1** | Offer engine | Pricing strategies produce correct results |
| **P2** | CRUD operations | Standard create/read/update flows |
| **P2** | Edge cases | Empty states, max values, Unicode text |

### 11.3 Test Fixtures

```typescript
// test/fixtures/company.fixture.ts
export const testCompanyA = {
  id: 'company-aaa',
  name: 'Électricité SA',
  defaultVatRate: 810,
  defaultMarginFactor: 120,
};

export const testCompanyB = {
  id: 'company-bbb',
  name: 'Sanitaire GmbH',
  // ... different company for isolation tests
};
```

### 11.4 CI Test Run

```yaml
# .github/workflows/ci.yml
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: supabase/postgres:15
        env:
          POSTGRES_PASSWORD: test
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run db:migrate:test
      - run: npm run test:unit
      - run: npm run test:integration
      - run: npm run test:e2e
      - run: npm run lint
      - run: npm run typecheck
```

---

## 12. Mobile App Strategy

### 12.1 Technology: React Native with Expo

| Decision | Reason |
|----------|--------|
| **Expo** | Faster dev cycle, OTA updates, managed build service |
| **React Native** | Share types/utils with web, single language (TypeScript) |
| **Expo Router** | File-based routing, matches web patterns |
| **MMKV** | Fast key-value storage for offline queue |
| **NetInfo** | Detect online/offline state reliably |

### 12.2 Offline Queue (Option B)

```typescript
// services/offline-queue.ts
interface QueuedAction {
  id: string;
  endpoint: string;
  method: 'POST' | 'PUT';
  body: object;
  idempotencyKey: string;
  createdAt: string;
}

class OfflineQueue {
  private queue: QueuedAction[] = [];
  
  async enqueue(action: Omit<QueuedAction, 'id' | 'idempotencyKey' | 'createdAt'>) {
    this.queue.push({
      ...action,
      id: uuid(),
      idempotencyKey: uuid(),
      createdAt: new Date().toISOString(),
    });
    await this.persist(); // MMKV
  }
  
  async sync() {
    const pending = [...this.queue];
    for (const action of pending) {
      try {
        await api.request(action.endpoint, {
          method: action.method,
          body: JSON.stringify(action.body),
          headers: { 'x-idempotency-key': action.idempotencyKey },
        });
        this.queue = this.queue.filter(a => a.id !== action.id);
        await this.persist();
      } catch (e) {
        if (e.status === 409) {
          // Conflict: server already has this → remove from queue
          this.queue = this.queue.filter(a => a.id !== action.id);
          await this.persist();
        } else {
          break; // Stop sync, retry later
        }
      }
    }
  }
}
```

### 12.3 Push Notifications (FCM via Expo)

Push notifications use **Firebase Cloud Messaging (FCM)** for both Android and iOS, delivered through **Expo Push Notifications**.

**Token registration flow:**

```typescript
// Mobile: register push token on app launch
async function registerPushToken(userId: string) {
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;

  const token = (await Notifications.getExpoPushTokenAsync()).data;
  await api.post('/push-devices', {
    token,
    platform: Platform.OS, // 'ios' | 'android'
    deviceName: Device.deviceName,
  });
}
```

**API-side delivery:**

```typescript
@Injectable()
export class PushNotificationService {
  private expo = new Expo();

  async send(userId: string, notification: {
    title: string;
    body: string;
    data?: Record<string, string>;
  }): Promise<void> {
    // 1. Find all active devices for user
    const devices = await this.pushDeviceRepo.find({
      where: { userId, isActive: true },
    });
    if (devices.length === 0) return;

    // 2. Build messages
    const messages: ExpoPushMessage[] = devices.map(d => ({
      to: d.token,
      title: notification.title,
      body: notification.body,
      data: notification.data,
      sound: 'default',
    }));

    // 3. Send via Expo
    const tickets = await this.expo.sendPushNotificationsAsync(messages);

    // 4. Track delivery
    for (let i = 0; i < tickets.length; i++) {
      if (tickets[i].status === 'error') {
        // Deactivate invalid tokens
        if (tickets[i].details?.error === 'DeviceNotRegistered') {
          await this.pushDeviceRepo.update(devices[i].id, { isActive: false });
        }
      }
    }

    // 5. Mark notification as push-sent
    if (notification.data?.notificationId) {
      await this.notificationRepo.update(notification.data.notificationId, {
        pushSent: true,
        pushSentAt: new Date(),
      });
    }
  }
}
```

**When to notify (examples):**

| Event | Recipients | Priority |
|-------|-----------|----------|
| Task assigned | Assigned worker | High |
| Time entry approved/rejected | Worker who submitted | Normal |
| Contract signed | Project manager | High |
| Invoice paid | Company admin | Normal |
| Site meeting scheduled | All project participants | Normal |

---

## 13. CI/CD Pipeline

```
Push to feature branch:
  → Lint + typecheck + unit tests (3 min)
  → Integration tests against local Supabase (5 min)
  → Build check (2 min)

Merge to develop:
  → All above + E2E API tests (8 min)
  → Deploy to staging (Railway preview env)
  → Smoke test against staging

Tag release (v1.x.x):
  → All tests
  → Deploy to production (Railway + Supabase)
  → Sentry release + source maps
  → Notify team
```

---

## 14. What Info to Provide at Each Stage

This is the practical guide for **what to tell Claude Code at the start of each session**.

### Phase 0 (Foundation)
```
Provide: This document (build strategy), PRD sections 3 + 5 + 18
Load: Root CLAUDE.md (will be created during this phase)
```

### Phase 1 (CRM & Catalogue)
```
Provide: PRD sections 7.1-7.3 + 9, sample CSV, DATA_MODEL.md
Load: Root CLAUDE.md, packages/db/CLAUDE.md
Ask Claude Code: "Read docs/DATA_MODEL.md and packages/api/src/modules/crm/SPEC.md"
```

### Phase 2 (Offer Engine)
```
Provide: PRD section 7 (complete), GEE_Cahier_des_charges, room profile data
Load: Root CLAUDE.md, catalogue module CLAUDE.md (dependency)
Ask Claude Code: "Read docs/CROSS_MODULE_CONTRACTS.md for catalogue→offer interface"
```

### Phase 3 (Contracts & Projects)
```
Provide: PRD sections 8 + 9, DATA_MODEL.md (refreshed)
Load: Root CLAUDE.md, offer module CLAUDE.md (dependency)
Ask Claude Code: "Read the offer→project contract in packages/shared/contracts/"
```

### Phase 4-7 (Field Ops → Admin)
```
Same pattern: PRD section for that module + DATA_MODEL.md + relevant contracts
Always run tests first: "Run npm test and report any failures before we start"
```

### Phase 8 (Mobile)
```
Provide: PRD section 20, API_REFERENCE.md (all endpoints are built by now)
Special: "Read packages/mobile/CLAUDE.md for offline queue patterns"
```

### Phase 9 (Integration & Security)
```
Provide: docs/SECURITY.md, full test suite results
Ask Claude Code: "Run the full E2E suite, then audit all RLS policies"
```

---

## 15. Risk Register

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **Context loss between sessions** | HIGH | HIGH | CLAUDE.md system, SPEC.md per module, auto-generated reference docs |
| **Cross-module contract breaks** | HIGH | MEDIUM | Explicit contract files, integration tests, event-driven communication |
| **Tenant data leakage** | CRITICAL | LOW | RLS on every table, cross-tenant tests, security audit in Phase 9 |
| **Gapless invoice race condition** | HIGH | MEDIUM | Advisory locks, transaction isolation, concurrent stress tests |
| **Money rounding errors** | HIGH | MEDIUM | Integer centimes everywhere, Swiss rounding util with 100% test coverage |
| **Offline sync data loss** | MEDIUM | MEDIUM | Idempotency keys, persistent queue (MMKV), retry with backoff |
| **Scope creep per module** | MEDIUM | HIGH | Strict SPEC.md per module, one module per session rule |
| **Performance degradation at scale** | MEDIUM | MEDIUM | Indexed queries, pagination everywhere, offer generation benchmarks |
| **Supabase RLS complexity** | MEDIUM | MEDIUM | Simple policy patterns, tested with fixtures, documented in db/CLAUDE.md |
| **PDF microservice latency** | MEDIUM | MEDIUM | 30s timeout, async generation for batch jobs, pre-warming Railway service |
| **Stripe webhook reliability** | HIGH | LOW | Webhook signature verification, idempotent handlers, missed-event reconciliation cron |

---

*This document is the engineering blueprint for OXACAN. It should be saved as a project doc and referenced at the start of every Claude Code session. Last updated: 2026-09-28.*
