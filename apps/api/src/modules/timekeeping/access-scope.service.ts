import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotFoundError } from '@oxacan/shared-types';
import { TeamMember } from '../hr/entities/team-member.entity';
import { Project } from '../projects/entities/project.entity';
import { Task } from '../projects/entities/task.entity';

/** The authenticated caller, as set by JwtAuthGuard on request.user. */
export interface ScopeUser {
  id: string;
  companyId: string;
  role: string;
}

/** Roles that see and approve every user's field data in their company. */
const OFFICE = ['ADMIN', 'PROJECT_MANAGER'];

/**
 * Field-data visibility (PRD: "Le chef d'équipe valide les heures de ses ouvriers").
 *
 *  - ADMIN / PROJECT_MANAGER → every user of the company (null = unrestricted)
 *  - TEAM_LEADER             → self + members of the teams they lead
 *  - WORKER (and any other)  → self only
 */
@Injectable()
export class AccessScopeService {
  constructor(
    @InjectRepository(TeamMember)
    private readonly teamMemberRepo: Repository<TeamMember>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
  ) {}

  /** User ids whose time entries / expenses / daily reports the caller may see; null = all. */
  async visibleUserIds(user: ScopeUser): Promise<string[] | null> {
    if (OFFICE.includes(user.role)) return null;
    if (user.role === 'TEAM_LEADER') {
      const members = await this.ledMemberIds(user);
      return [user.id, ...members.filter((id) => id !== user.id)];
    }
    return [user.id];
  }

  /** True when `targetUserId` is inside the caller's visibility scope. */
  async canSee(user: ScopeUser, targetUserId: string): Promise<boolean> {
    const scope = await this.visibleUserIds(user);
    return scope === null || scope.includes(targetUserId);
  }

  /**
   * Approve/reject gate. Office roles may act on anyone's records (including a team
   * leader's). A TEAM_LEADER may act only on records owned by members of teams they
   * lead — never their own. Any owner outside that set → 403, nothing is changed.
   */
  async assertCanApprove(
    user: ScopeUser,
    ownerIds: string[],
    requestedCount: number = ownerIds.length,
  ): Promise<void> {
    if (OFFICE.includes(user.role)) return;
    if (user.role !== 'TEAM_LEADER') {
      throw new ForbiddenException('Insufficient role');
    }
    const allowed = new Set((await this.ledMemberIds(user)).filter((id) => id !== user.id));
    // requestedCount > ownerIds.length: some ids matched no record in the company —
    // they are outside the leader's set too, so refuse the whole batch.
    if (ownerIds.length < requestedCount || ownerIds.some((id) => !allowed.has(id))) {
      throw new ForbiddenException(
        'A team leader may only approve or reject records of their own team members.',
      );
    }
  }

  /** Rejects a projectId / taskId that does not belong to the caller's company (404). */
  async assertProjectInCompany(companyId: string, projectId: string): Promise<void> {
    const exists = await this.projectRepo.exists({ where: { id: projectId, companyId } });
    if (!exists) throw new NotFoundError('Project', projectId);
  }

  async assertTaskInCompany(companyId: string, taskId: string): Promise<void> {
    const exists = await this.taskRepo.exists({ where: { id: taskId, companyId } });
    if (!exists) throw new NotFoundError('Task', taskId);
  }

  /** Distinct user ids of members of every team led by `user` (may include the leader). */
  private async ledMemberIds(user: ScopeUser): Promise<string[]> {
    const rows: { userId: string }[] = await this.teamMemberRepo
      .createQueryBuilder('tm')
      .innerJoin('tm.team', 't')
      .select('DISTINCT tm.user_id', 'userId')
      .where('t.leader_id = :leaderId', { leaderId: user.id })
      .andWhere('t.company_id = :companyId', { companyId: user.companyId })
      .andWhere('tm.company_id = :companyId', { companyId: user.companyId })
      .getRawMany();
    return rows.map((r) => r.userId);
  }
}

/** Parses ?page / ?limit into sane bounds (limit 1..200, default 25). */
export function parsePaging(page?: string, limit?: string): { page: number; limit: number } {
  const p = parseInt(page ?? '', 10);
  const l = parseInt(limit ?? '', 10);
  return {
    page: Number.isFinite(p) && p > 0 ? p : 1,
    limit: Number.isFinite(l) && l > 0 ? Math.min(l, 200) : 25,
  };
}
