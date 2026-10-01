/**
 * Data retention policy (PRD §25 "Politique de rétention des données", §24 Swiss legal
 * requirements) as data: every rule is one predicate on one table, shared by the dry run (COUNT)
 * and the run itself (DELETE / UPDATE), so a preview always reports exactly what a run touches.
 * Pure (no Nest / TypeORM imports) so tests can check the policy itself.
 *
 * Financial and legal records are never deleted or rewritten: CO art. 957–958f require 10 years
 * (PRD §24.1, §25.2) and PRD §25.4 forbids deleting invoices and journal entries. Those tables
 * are listed in PROTECTED_TABLES and no rule may target them (asserted at module load).
 */

/** PRD §25.2: personal data is kept for "durée de la relation + rétention légale". The legal
 *  periods in §24.1/§25.2 are 10 years (accounting records, payroll as supporting documents, audit
 *  logs); the claim to an employment certificate (CO art. 330a) also prescribes after 10 years
 *  (CO art. 127). Counted from the deactivation (end of the relationship, §25.1). */
export const EMPLOYEE_RETENTION_YEARS = 10;

/** PRD §25.3: a departing company can export everything for 90 days after termination; its
 *  personal data is anonymised after that window. */
export const COMPANY_EXPORT_WINDOW_DAYS = 90;

/** Technical data (PRD §25.2 "selon nécessité"): read notifications / any notification. */
export const READ_NOTIFICATION_DAYS = 180;
export const NOTIFICATION_MAX_DAYS = 365;

/** Expired or revoked client-portal links are kept a little for support questions, then purged. */
export const PORTAL_TOKEN_GRACE_DAYS = 30;

/** Push-device tokens that were switched off and not used since. */
export const PUSH_DEVICE_INACTIVE_DAYS = 90;

/** Tables that hold legal / financial records. No retention rule may touch them. */
export const PROTECTED_TABLES: readonly string[] = [
  'invoice',
  'invoice_line',
  'payment',
  'journal_entry',
  'journal_entry_line',
  'chart_of_accounts',
  'contract',
  'contract_amendment',
  'plus_value',
  'expense',
  'time_entry',
  'purchase_order',
  'purchase_order_line',
  'billing_event',
  'subscription',
  'audit_log',
];

export type RetentionAction = 'delete' | 'anonymise';

export interface RetentionRule {
  /** Stable identifier, used in reports and audit entries. */
  key: string;
  table: string;
  action: RetentionAction;
  description: string;
  retention: string;
  legalBasis: string;
  /** Predicate on `table` (no alias). Constants only: no user input ever reaches it. */
  where: string;
  /** SET clause for 'anonymise' rules. */
  set?: string;
}

/** Companies whose subscription was cancelled before the export window. */
const DEPARTED_COMPANIES = `SELECT s.company_id FROM subscription s
  WHERE s.status = 'cancelled' AND s.cancelled_at < now() - interval '${COMPANY_EXPORT_WINDOW_DAYS} days'`;

/** Users due for anonymisation: deactivated past the retention period, or of a departed company. */
const userDue = (u: string) => `${u}anonymised_at IS NULL AND (
    (${u}is_active = false AND ${u}deactivated_at < now() - interval '${EMPLOYEE_RETENTION_YEARS} years')
    OR ${u}company_id IN (${DEPARTED_COMPANIES}))`;

const USER_DUE = userDue('');
const USERS_DUE = `SELECT u.id FROM app_user u WHERE ${userDue('u.')}`;

/**
 * In execution order: rows that depend on a user are removed before the user is anonymised (the
 * anonymisation then makes USER_DUE false, so a re-run finds nothing).
 */
export const RETENTION_RULES: readonly RetentionRule[] = [
  {
    key: 'notification.anonymised_user',
    table: 'notification',
    action: 'delete',
    description: 'Notifications of users being anonymised',
    retention: `With the user (${EMPLOYEE_RETENTION_YEARS} years after deactivation)`,
    legalBasis: 'PRD §25.1–25.2, LPD / RGPD minimisation',
    where: `user_id IN (${USERS_DUE})`,
  },
  {
    key: 'push_device.anonymised_user',
    table: 'push_device',
    action: 'delete',
    description: 'Push-device tokens of users being anonymised',
    retention: `With the user (${EMPLOYEE_RETENTION_YEARS} years after deactivation)`,
    legalBasis: 'PRD §25.1–25.2, LPD / RGPD minimisation',
    where: `user_id IN (${USERS_DUE})`,
  },
  {
    key: 'app_user.anonymise',
    table: 'app_user',
    action: 'anonymise',
    description:
      'Anonymise deactivated employees (name, e-mail, phone, hire date, qualifications, login link); ' +
      'the row, role, rate and CCT stay so time entries, payroll and accounting keep their references',
    retention: `${EMPLOYEE_RETENTION_YEARS} years after deactivation; ${COMPANY_EXPORT_WINDOW_DAYS} days after a company's termination`,
    legalBasis: 'PRD §24.2 (droit à l’effacement = anonymisation), §25.1, §25.2, §25.3; CO art. 127 / 330a, 958f',
    where: USER_DUE,
    set: `email = 'anonymised-' || id || '@anonymised.invalid',
      first_name = 'Utilisateur', last_name = 'Anonymisé', phone = NULL, supabase_auth_id = NULL,
      hire_date = NULL, qualifications = '[]'::jsonb, is_active = false,
      deactivated_at = coalesce(deactivated_at, now()), anonymised_at = now(), updated_at = now()`,
  },
  {
    key: 'client_contact.departed_company',
    table: 'client_contact',
    action: 'anonymise',
    description: 'Anonymise client contact persons of companies that left OXACAN',
    retention: `${COMPANY_EXPORT_WINDOW_DAYS} days after termination`,
    legalBasis: 'PRD §25.3',
    where: `anonymised_at IS NULL AND company_id IN (${DEPARTED_COMPANIES})`,
    set: `first_name = 'Contact', last_name = 'Anonymisé', role = NULL, email = NULL, phone = NULL,
      anonymised_at = now()`,
  },
  {
    key: 'client.departed_company',
    table: 'client',
    action: 'anonymise',
    description:
      'Remove the contact person, e-mail and phone of clients of companies that left OXACAN ' +
      '(name and address stay: they are part of the archived invoices)',
    retention: `${COMPANY_EXPORT_WINDOW_DAYS} days after termination`,
    legalBasis: 'PRD §25.3 (archivage légal des données comptables anonymisées)',
    where: `company_id IN (${DEPARTED_COMPANIES})
      AND (contact_person IS NOT NULL OR email IS NOT NULL OR phone IS NOT NULL)`,
    set: `contact_person = NULL, email = NULL, phone = NULL, updated_at = now()`,
  },
  {
    key: 'portal_token.expired',
    table: 'portal_token',
    action: 'delete',
    description: 'Client-portal links that expired or were revoked, and all links of departed companies',
    retention: `${PORTAL_TOKEN_GRACE_DAYS} days after expiry or revocation`,
    legalBasis: 'PRD §25.2 (données techniques: selon nécessité), §25.3',
    where: `expires_at < now() - interval '${PORTAL_TOKEN_GRACE_DAYS} days'
      OR (is_active = false AND created_at < now() - interval '${PORTAL_TOKEN_GRACE_DAYS} days')
      OR company_id IN (${DEPARTED_COMPANIES})`,
  },
  {
    key: 'notification.old',
    table: 'notification',
    action: 'delete',
    description: `Read notifications older than ${READ_NOTIFICATION_DAYS} days, any older than ${NOTIFICATION_MAX_DAYS} days`,
    retention: `${READ_NOTIFICATION_DAYS} days once read, ${NOTIFICATION_MAX_DAYS} days at most`,
    legalBasis: 'PRD §25.2 (données techniques: selon nécessité)',
    // Rows of users being anonymised are counted by the first rule only (they are gone by now).
    where: `((is_read = true AND created_at < now() - interval '${READ_NOTIFICATION_DAYS} days')
      OR created_at < now() - interval '${NOTIFICATION_MAX_DAYS} days')
      AND user_id NOT IN (${USERS_DUE})`,
  },
  {
    key: 'push_device.inactive',
    table: 'push_device',
    action: 'delete',
    description: `Disabled push devices unused for ${PUSH_DEVICE_INACTIVE_DAYS} days`,
    retention: `${PUSH_DEVICE_INACTIVE_DAYS} days after last use`,
    legalBasis: 'PRD §25.2 (données techniques: selon nécessité)',
    where: `is_active = false AND last_used_at < now() - interval '${PUSH_DEVICE_INACTIVE_DAYS} days'
      AND user_id NOT IN (${USERS_DUE})`,
  },
  {
    key: 'idempotency_key.expired',
    table: 'idempotency_key',
    action: 'delete',
    description: 'Expired Idempotency-Key records (48 h TTL)',
    retention: 'Until expires_at',
    legalBasis: 'PRD §25.2 (données techniques: selon nécessité)',
    where: `expires_at < now()`,
  },
];

for (const rule of RETENTION_RULES) {
  if (PROTECTED_TABLES.includes(rule.table)) {
    throw new Error(`Retention rule ${rule.key} targets protected table ${rule.table}`);
  }
  if (rule.action === 'anonymise' && !rule.set) {
    throw new Error(`Retention rule ${rule.key} anonymises without a SET clause`);
  }
}

/** Predicate of a rule, optionally limited to one company (bind parameter $1). */
export function scopedWhere(rule: RetentionRule, scoped: boolean): string {
  return scoped ? `(${rule.where}) AND company_id = $1` : `(${rule.where})`;
}

/** SELECT company_id, count(*) of the rows the rule would touch. */
export function previewSql(rule: RetentionRule, scoped: boolean): string {
  return `SELECT company_id, count(*)::int AS n FROM ${rule.table} WHERE ${scopedWhere(rule, scoped)} GROUP BY company_id`;
}

/** The DELETE / UPDATE of a rule, returning the touched rows' counts per company. */
export function applySql(rule: RetentionRule, scoped: boolean): string {
  const where = scopedWhere(rule, scoped);
  const change =
    rule.action === 'delete'
      ? `DELETE FROM ${rule.table} WHERE ${where} RETURNING company_id`
      : `UPDATE ${rule.table} SET ${rule.set} WHERE ${where} RETURNING company_id`;
  return `WITH changed AS (${change}) SELECT company_id, count(*)::int AS n FROM changed GROUP BY company_id`;
}
