import { EntityManager } from 'typeorm';
import { NotFoundError } from '@oxacan/shared-types';

/**
 * 404 unless the project exists in the caller's company. Per-project summaries otherwise answer
 * another company's project id with an empty 200 (RLS hides its rows) instead of "not found".
 */
export async function assertProjectExists(m: EntityManager, companyId: string, projectId: string): Promise<void> {
  const [row] = await m.query('SELECT 1 FROM project WHERE id = $1 AND company_id = $2', [projectId, companyId]);
  if (!row) throw new NotFoundError('Project', projectId);
}
