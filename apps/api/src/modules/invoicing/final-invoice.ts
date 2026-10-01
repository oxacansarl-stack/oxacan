/*
 * Final invoice ("Facture finale" / décompte final, PRD §15.1) and retention release (§15.4).
 * Plain queries on a { query } (DataSource, EntityManager or QueryRunner), shared by
 * InvoicingService and ContractsService.
 */

type Db = { query: (sql: string, params?: unknown[]) => Promise<any> };

/** Invoices that still count: not cancelled and not neutralised by a (non-cancelled) credit note. */
export const UNCREDITED_INVOICES_SQL = `
  SELECT i.* FROM invoice i
   WHERE i.company_id = $1 AND i.project_id = $2 AND i.status <> 'cancelled'
     AND NOT EXISTS (SELECT 1 FROM invoice cn
                      WHERE cn.company_id = i.company_id AND cn.reference_invoice_id = i.id
                        AND cn.type = 'credit_note' AND cn.status <> 'cancelled')`;

/** The project's final invoice (draft or issued) unless it was cancelled or credited. */
export async function liveFinalInvoice(
  db: Db,
  companyId: string,
  projectId: string,
): Promise<{ id: string; invoiceNumber: string; status: string; createdAt: Date } | null> {
  const [row] = await db.query(
    `WITH uncredited AS (${UNCREDITED_INVOICES_SQL})
     SELECT id, invoice_number AS "invoiceNumber", status, created_at AS "createdAt" FROM uncredited
      WHERE type = 'final_invoice' ORDER BY created_at DESC LIMIT 1`,
    [companyId, projectId],
  );
  return row ?? null;
}

/**
 * Retention held on the project: what its issued invoices and situations (not cancelled, not
 * credited) held back. Issuing them debited it to 1100 as a receivable; the final invoice
 * releases it all.
 */
export async function heldRetentionCents(db: Db, companyId: string, projectId: string): Promise<number> {
  const [{ held }] = await db.query(
    `WITH uncredited AS (${UNCREDITED_INVOICES_SQL})
     SELECT COALESCE(SUM(retention_amount_cents), 0)::bigint AS held FROM uncredited
      WHERE type IN ('invoice', 'situation') AND status <> 'draft'`,
    [companyId, projectId],
  );
  return Number(held);
}

/** Totals of the project's issued invoices and situations (not cancelled, not credited), and its issued acomptes. */
export async function billedSoFar(db: Db, companyId: string, projectId: string) {
  const [r] = await db.query(
    `WITH uncredited AS (${UNCREDITED_INVOICES_SQL})
     SELECT COALESCE(SUM(subtotal_ht_cents) FILTER (WHERE type IN ('invoice', 'situation')), 0)::bigint AS "subtotalHtCents",
            COALESCE(SUM(vat_amount_cents) FILTER (WHERE type IN ('invoice', 'situation')), 0)::bigint AS "vatCents",
            COALESCE(SUM(retention_amount_cents) FILTER (WHERE type IN ('invoice', 'situation')), 0)::bigint AS "retentionHeldCents",
            COALESCE(SUM(prior_acomptes_cents) FILTER (WHERE type IN ('invoice', 'situation')), 0)::bigint AS "acomptesDeductedCents",
            COALESCE(SUM(total_ttc_cents) FILTER (WHERE type IN ('invoice', 'situation')), 0)::bigint AS "totalTtcCents",
            COALESCE(SUM(total_ttc_cents) FILTER (WHERE type = 'acompte'), 0)::bigint AS "acomptesTtcCents",
            COUNT(*) FILTER (WHERE type IN ('invoice', 'situation'))::int AS "invoiceCount"
       FROM uncredited WHERE status <> 'draft'`,
    [companyId, projectId],
  );
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Number(v)])) as {
    subtotalHtCents: number; vatCents: number; retentionHeldCents: number; acomptesDeductedCents: number;
    totalTtcCents: number; acomptesTtcCents: number; invoiceCount: number;
  };
}

/** Numbers of the project's draft invoices (credit notes aside): they must be issued or cancelled before the final invoice. */
export async function pendingDraftNumbers(db: Db, companyId: string, projectId: string): Promise<string[]> {
  const rows: { invoice_number: string }[] = await db.query(
    `SELECT invoice_number FROM invoice
      WHERE company_id = $1 AND project_id = $2 AND status = 'draft' AND type <> 'credit_note'
      ORDER BY invoice_number`,
    [companyId, projectId],
  );
  return rows.map((r) => r.invoice_number);
}
