/*
 * Acompte schedule of a contract (PRD §15.6 "Acompte : rappel pour les acomptes à émettre").
 * A contract plans acomptes (a due date and a fixed HT amount, or a percentage of the contract's
 * HT value); an acompte invoice created with acompteScheduleItemId bills one of them. An item is
 * "issued" while a sent (or later) acompte invoice that is neither cancelled nor credited bills it.
 *
 * These are plain queries on a { query } (DataSource, EntityManager or QueryRunner), so the alerts
 * job can run them inside its own tenant transaction.
 */

type Db = { query: (sql: string, params?: unknown[]) => Promise<any> };

/** 'planned': nothing billed yet; 'draft': a draft acompte bills it; 'issued': a sent (or paid…) acompte bills it. */
export type AcompteScheduleStatus = 'planned' | 'draft' | 'issued';

export interface AcompteScheduleRow {
  id: string;
  contractId: string;
  dueDate: string;
  label: string | null;
  /** Fixed HT amount, when the item was planned as an amount. */
  plannedAmountHtCents: number | null;
  /** Basis points of the contract's HT value, when planned as a percentage (1000 = 10 %). */
  percentBps: number | null;
  /** HT amount to bill: the fixed amount, or the percentage of the contract's current HT value. */
  amountHtCents: number;
  status: AcompteScheduleStatus;
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceStatus: string | null;
}

export interface DueAcompte extends AcompteScheduleRow {
  contractReference: string;
  projectId: string;
  projectName: string;
  clientId: string;
  /** Days between the due date and asOf: positive when late, 0 on the day, negative when upcoming. */
  daysLate: number;
}

/**
 * The contract's HT value: its offer's HT total plus the HT deltas of its signed amendments
 * (the same deltas ContractsService.signAmendment adds to the contract's TTC total).
 */
const CONTRACT_HT_SQL = `(COALESCE(o.total_ht_cents, 0) + COALESCE((
    SELECT SUM(a.amount_delta_cents) FROM contract_amendment a
     WHERE a.company_id = c.company_id AND a.contract_id = c.id AND a.status = 'signed'), 0))`;

/** Columns of an item with its resolved amount and the live acompte invoice billing it (s, c, o, inv). */
const ITEM_SELECT = `
  s.id, s.contract_id AS "contractId", to_char(s.due_date, 'YYYY-MM-DD') AS "dueDate", s.label,
  s.amount_ht_cents::bigint AS "plannedAmountHtCents", s.percent_bps AS "percentBps",
  COALESCE(s.amount_ht_cents, ROUND(${CONTRACT_HT_SQL} * s.percent_bps / 10000.0))::bigint AS "amountHtCents",
  CASE WHEN inv.id IS NULL THEN 'planned' WHEN inv.status = 'draft' THEN 'draft' ELSE 'issued' END AS status,
  inv.id AS "invoiceId", inv.invoice_number AS "invoiceNumber", inv.status AS "invoiceStatus"`;

const ITEM_FROM = `
  FROM acompte_schedule_item s
  JOIN contract c ON c.company_id = s.company_id AND c.id = s.contract_id
  LEFT JOIN offer o ON o.company_id = c.company_id AND o.id = c.offer_id
  LEFT JOIN LATERAL (
    SELECT i.id, i.invoice_number, i.status FROM invoice i
     WHERE i.company_id = s.company_id AND i.acompte_schedule_item_id = s.id AND i.status <> 'cancelled'
       AND NOT EXISTS (SELECT 1 FROM invoice cn
                        WHERE cn.company_id = i.company_id AND cn.reference_invoice_id = i.id
                          AND cn.type = 'credit_note' AND cn.status <> 'cancelled')
     ORDER BY i.created_at DESC LIMIT 1) inv ON true`;

function toRow<T extends AcompteScheduleRow>(r: any): T {
  return {
    ...r,
    plannedAmountHtCents: r.plannedAmountHtCents == null ? null : Number(r.plannedAmountHtCents),
    percentBps: r.percentBps == null ? null : Number(r.percentBps),
    amountHtCents: Number(r.amountHtCents),
    ...(r.daysLate !== undefined ? { daysLate: Number(r.daysLate) } : {}),
  };
}

/** One contract's schedule, in due-date order (or a single item of it with itemId). */
export async function acompteSchedule(db: Db, companyId: string, contractId: string, itemId?: string): Promise<AcompteScheduleRow[]> {
  const rows = await db.query(
    `SELECT ${ITEM_SELECT} ${ITEM_FROM}
      WHERE s.company_id = $1 AND s.contract_id = $2 AND ($3::uuid IS NULL OR s.id = $3::uuid)
      ORDER BY s.due_date, s.created_at`,
    [companyId, contractId, itemId ?? null],
  );
  return rows.map((r: any) => toRow(r));
}

/** A single item by id (any contract of the company), or null. */
export async function acompteScheduleItem(db: Db, companyId: string, itemId: string): Promise<AcompteScheduleRow | null> {
  const [row] = await db.query(
    `SELECT ${ITEM_SELECT} ${ITEM_FROM} WHERE s.company_id = $1 AND s.id = $2`,
    [companyId, itemId],
  );
  return row ? toRow(row) : null;
}

/**
 * Planned acomptes "à émettre": due on or before asOf + withinDays and not issued yet (nothing
 * bills them, or only a draft does: status 'planned' or 'draft'), on contracts that have a project
 * and are not terminated, for projects without a final invoice (no acompte can be created after
 * it; a cancelled or credited one doesn't count). For the acompte reminder
 * of the alerts job: one row per schedule item, so the item id can be the alert's subject.
 *
 * @param opts.asOf YYYY-MM-DD, default today (database date)
 * @param opts.withinDays also include items due in the next N days (default 0)
 */
export async function findDueAcomptes(
  db: Db,
  companyId: string,
  opts: { asOf?: string; withinDays?: number; projectId?: string } = {},
): Promise<DueAcompte[]> {
  const rows = await db.query(
    `SELECT ${ITEM_SELECT}, c.reference AS "contractReference", p.id AS "projectId", p.name AS "projectName",
            c.client_id AS "clientId", (COALESCE($2::date, CURRENT_DATE) - s.due_date) AS "daysLate"
       ${ITEM_FROM}
       JOIN project p ON p.company_id = c.company_id AND p.contract_id = c.id
      WHERE s.company_id = $1
        AND s.due_date <= COALESCE($2::date, CURRENT_DATE) + $3::int
        AND (inv.id IS NULL OR inv.status = 'draft')
        AND c.status <> 'terminated'
        AND ($4::uuid IS NULL OR p.id = $4::uuid)
        AND NOT EXISTS (SELECT 1 FROM invoice f
                         WHERE f.company_id = p.company_id AND f.project_id = p.id AND f.type = 'final_invoice'
                           AND f.status <> 'cancelled'
                           AND NOT EXISTS (SELECT 1 FROM invoice cn
                                            WHERE cn.company_id = f.company_id AND cn.reference_invoice_id = f.id
                                              AND cn.type = 'credit_note' AND cn.status <> 'cancelled'))
      ORDER BY s.due_date, p.name, s.created_at`,
    [companyId, opts.asOf ?? null, Math.max(0, Math.floor(opts.withinDays ?? 0)), opts.projectId ?? null],
  );
  return rows.map((r: any) => toRow<DueAcompte>(r));
}
