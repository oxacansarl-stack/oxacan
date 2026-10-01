/**
 * Actual cost of a project, in CHF centimes HT. The single definition shared by
 * ProjectsService.updateProgress (stored in project.actual_cost_cents) and the budget-drift alert.
 *
 *   approved time entries   SUM(time_entry.cost_cents)                    (cost frozen at entry)
 * + approved expenses, HT   SUM(amount_cents − COALESCE(vat_amount_cents, 0))
 *                           (amount_cents is the TTC paid; unknown VAT → the TTC amount is used)
 * + purchase-order goods    SUM(ROUND(delivered_quantity × unit_price_cents)) per line of the
 *   delivered / received    project's orders: the HT value of what was actually delivered, not
 *                           ordered. Counted whatever the order status (a cancelled order keeps the
 *                           goods it delivered; a draft cannot have deliveries).
 *
 * There is no subcontract / supplier-invoice model: subcontractor costs only reach the project as
 * approved expenses of category 'subcontractor'.
 */

/** `$1`, `$2::uuid`, `p.id`, `project_id`: a bind placeholder or a column reference, nothing else. */
const SQL_REF = /^(\$\d+|[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?)(::uuid)?$/i;

function ref(value: string, what: string): string {
  if (!SQL_REF.test(value)) throw new Error(`projectActualCostSql: invalid ${what} reference '${value}'`);
  return value;
}

/**
 * A scalar SQL expression (bigint) of the project's actual cost. `projectId` and `companyId` are
 * SQL references, never values: bind placeholders (`$1`) or columns of an outer query (`p.id`).
 * The company filter is explicit on every table on top of RLS.
 */
export function projectActualCostSql(projectId: string, companyId: string): string {
  const p = ref(projectId, 'project');
  const c = ref(companyId, 'company');
  return `(COALESCE((SELECT SUM(t.cost_cents) FROM time_entry t
                      WHERE t.project_id = ${p} AND t.company_id = ${c} AND t.status = 'approved'), 0)
         + COALESCE((SELECT SUM(e.amount_cents - COALESCE(e.vat_amount_cents, 0)) FROM expense e
                      WHERE e.project_id = ${p} AND e.company_id = ${c} AND e.status = 'approved'), 0)
         + COALESCE((SELECT SUM(ROUND(COALESCE(l.delivered_quantity, 0)::numeric * l.unit_price_cents))
                       FROM purchase_order_line l
                       JOIN purchase_order po ON po.id = l.purchase_order_id AND po.company_id = l.company_id
                      WHERE po.project_id = ${p} AND po.company_id = ${c} AND l.company_id = ${c}), 0)
         )::bigint`;
}
