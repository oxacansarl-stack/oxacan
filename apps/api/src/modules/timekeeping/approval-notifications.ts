import type { EntityManager } from 'typeorm';
import type { NotificationsService } from '../notifications/notifications.service';
import type { ScopeUser } from './access-scope.service';

/**
 * Tells each owner of approved / rejected hours or expenses about the decision: one notification
 * per owner and batch, inside the approval transaction. Approvers aren't notified of their own.
 */
export async function notifyOwners(
  notifications: NotificationsService,
  manager: EntityManager,
  approver: ScopeUser,
  records: { id: string; userId: string }[],
  type: string,
  title: (count: number) => string,
  reason?: string,
): Promise<void> {
  const byOwner = new Map<string, string[]>();
  for (const r of records) {
    if (r.userId === approver.id) continue;
    byOwner.set(r.userId, [...(byOwner.get(r.userId) ?? []), r.id]);
  }
  for (const [userId, ids] of byOwner) {
    await notifications.createNotification(
      approver.companyId,
      {
        userId,
        type,
        title: title(ids.length),
        body: reason ? `Motif : ${reason}` : undefined,
        referenceType: type.split('_')[0],
        referenceId: ids.length === 1 ? ids[0] : undefined,
      },
      manager,
    );
  }
}
