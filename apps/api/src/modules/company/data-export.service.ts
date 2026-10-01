import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditAction } from '@oxacan/shared-types';

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

/**
 * Live credentials are not personal data to hand out: a portal link token opens the client portal
 * and a push token can message the device. The export shows that they exist, not their value.
 */
const REDACTED: Record<string, string[]> = {
  portal_token: ['token'],
  push_device: ['device_token'],
  // Cached API responses (e.g. a freshly created portal token); the records themselves are exported.
  idempotency_key: ['response_body'],
};

function redact(table: string, rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const columns = REDACTED[table];
  if (!columns) return rows;
  return rows.map((row) => ({ ...row, ...Object.fromEntries(columns.map((c) => [c, row[c] == null ? null : '[redacted]'])) }));
}

/**
 * Full export of a company's data (right of access under the Swiss revFADP / GDPR).
 * Discovers every tenant table from the schema so new modules are included automatically.
 */
@Injectable()
export class DataExportService {
  constructor(private readonly dataSource: DataSource) {}

  async exportCompany(companyId: string, userId: string) {
    const tableRows: { table_name: string }[] = await this.dataSource.query(
      `SELECT c.table_name FROM information_schema.columns c
       JOIN information_schema.tables t USING (table_schema, table_name)
       WHERE c.table_schema = 'public' AND c.column_name = 'company_id' AND t.table_type = 'BASE TABLE'
       ORDER BY c.table_name`,
    );

    const tables: Record<string, unknown[]> = {};
    for (const { table_name } of tableRows) {
      if (!IDENTIFIER.test(table_name)) continue;
      tables[table_name] = redact(
        table_name,
        await this.dataSource.query(`SELECT * FROM "${table_name}" WHERE company_id = $1`, [companyId]),
      );
    }
    // task_dependency has no company_id; it belongs to the company through its tasks.
    tables.task_dependency = await this.dataSource.query(
      `SELECT td.* FROM task_dependency td JOIN task t ON t.id = td.predecessor_id WHERE t.company_id = $1`,
      [companyId],
    );

    const [company] = await this.dataSource.query('SELECT * FROM company WHERE id = $1', [companyId]);

    await this.dataSource.query(
      `INSERT INTO audit_log (company_id, user_id, action, entity_type, entity_id, new_values)
       VALUES ($1, $2, $3, 'company', $1, $4)`,
      [companyId, userId, AuditAction.EXPORT, JSON.stringify({ tables: Object.keys(tables).length })],
    );

    return {
      exportedAt: new Date().toISOString(),
      format: 'oxacan-company-export/v1',
      company,
      rowCounts: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length])),
      tables,
    };
  }
}
