import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Team } from './entities/team.entity';
import { TeamMember } from './entities/team-member.entity';
import { AppUser } from '../auth/entities/app-user.entity';
import { NotFoundError, BusinessRuleError } from '@oxacan/shared-types';
import { CreateTeamDto, UpdateEmployeeDto, UpdateTeamDto } from './dto/hr.dto';

/** Columns of a user that are safe to show to TEAM_LEADERs (no pay rate, no auth ids). */
const PUBLIC_USER_COLUMNS = (alias: string) => [
  `${alias}.id`,
  `${alias}.firstName`,
  `${alias}.lastName`,
  `${alias}.email`,
  `${alias}.role`,
];

interface TeamFilters {
  page?: number;
  limit?: number;
  search?: string;
}

interface EmployeeFilters {
  page?: number;
  limit?: number;
  search?: string;
  role?: string;
  isActive?: boolean;
}


@Injectable()
export class HrService {
  constructor(
    @InjectRepository(Team)
    private readonly teamRepo: Repository<Team>,
    @InjectRepository(TeamMember)
    private readonly teamMemberRepo: Repository<TeamMember>,
    @InjectRepository(AppUser)
    private readonly userRepo: Repository<AppUser>,
  ) {}

  /* ───────────── Teams: List ───────────── */

  async findAllTeams(companyId: string, filters: TeamFilters = {}) {
    const { page = 1, limit = 25, search } = filters;

    const qb = this.teamRepo
      .createQueryBuilder('team')
      .leftJoin('team.leader', 'leader')
      .addSelect(PUBLIC_USER_COLUMNS('leader'))
      .loadRelationCountAndMap('team.memberCount', 'team.members')
      .where('team.company_id = :companyId', { companyId });

    if (search) {
      qb.andWhere('LOWER(team.name) LIKE :search', {
        search: `%${search.toLowerCase()}%`,
      });
    }

    qb.orderBy('team.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /* ───────────── Teams: Find by ID ───────────── */

  async findTeamById(companyId: string, id: string): Promise<Team> {
    const team = await this.teamRepo
      .createQueryBuilder('team')
      .leftJoin('team.leader', 'leader')
      .addSelect(PUBLIC_USER_COLUMNS('leader'))
      .leftJoinAndSelect('team.members', 'members', 'members.company_id = :companyId', { companyId })
      .leftJoin('members.user', 'memberUser')
      .addSelect(PUBLIC_USER_COLUMNS('memberUser'))
      .where('team.company_id = :companyId', { companyId })
      .andWhere('team.id = :id', { id })
      .getOne();
    if (!team) throw new NotFoundError('Team', id);
    return team;
  }

  /** Relation-free load for mutations (loaded relations would override changed FK columns on save). */
  private async loadTeam(companyId: string, id: string): Promise<Team> {
    const team = await this.teamRepo.findOne({ where: { id, companyId } });
    if (!team) throw new NotFoundError('Team', id);
    return team;
  }

  /* ───────────── Teams: Create ───────────── */

  async createTeam(
    companyId: string,
    dto: CreateTeamDto,
  ): Promise<Team> {
    if (dto.leaderId) {
      const leader = await this.userRepo.findOne({
        where: { id: dto.leaderId, companyId },
      });
      if (!leader) throw new NotFoundError('AppUser', dto.leaderId);
    }

    const team = this.teamRepo.create({
      companyId,
      name: dto.name,
      leaderId: dto.leaderId || null,
    });

    return this.teamRepo.save(team);
  }

  /* ───────────── Teams: Update ───────────── */

  async updateTeam(
    companyId: string,
    id: string,
    dto: UpdateTeamDto,
  ): Promise<Team> {
    const team = await this.loadTeam(companyId, id);

    if (dto.leaderId !== undefined) {
      if (dto.leaderId) {
        const leader = await this.userRepo.findOne({
          where: { id: dto.leaderId, companyId },
        });
        if (!leader) throw new NotFoundError('AppUser', dto.leaderId);
      }
      team.leaderId = dto.leaderId || null;
    }

    if (dto.name !== undefined) {
      team.name = dto.name;
    }

    return this.teamRepo.save(team);
  }

  /* ───────────── Teams: Delete ───────────── */

  async deleteTeam(companyId: string, id: string): Promise<void> {
    const team = await this.loadTeam(companyId, id);

    const memberCount = await this.teamMemberRepo.count({
      where: { teamId: team.id, companyId },
    });

    if (memberCount > 0) {
      throw new BusinessRuleError(
        'TEAM_HAS_MEMBERS',
        `Cannot delete team "${team.name}" because it has ${memberCount} member(s). Remove all members first.`,
      );
    }

    await this.teamRepo.remove(team);
  }

  /* ───────────── Members: Add ───────────── */

  async addMember(
    companyId: string,
    teamId: string,
    userId: string,
  ): Promise<TeamMember> {
    // Validate team exists
    await this.loadTeam(companyId, teamId);

    // Validate user exists
    const user = await this.userRepo.findOne({
      where: { id: userId, companyId },
    });
    if (!user) throw new NotFoundError('AppUser', userId);

    // Check for duplicate
    const existing = await this.teamMemberRepo.findOne({
      where: { teamId, userId, companyId },
    });
    if (existing) {
      throw new BusinessRuleError(
        'MEMBER_ALREADY_EXISTS',
        'This user is already a member of this team.',
      );
    }

    const member = this.teamMemberRepo.create({
      teamId,
      userId,
      companyId,
    });

    return this.teamMemberRepo.save(member);
  }

  /* ───────────── Members: Remove ───────────── */

  async removeMember(
    companyId: string,
    teamId: string,
    userId: string,
  ): Promise<void> {
    const member = await this.teamMemberRepo.findOne({
      where: { teamId, userId, companyId },
    });
    if (!member) throw new NotFoundError('TeamMember', `${teamId}/${userId}`);

    await this.teamMemberRepo.remove(member);
  }

  /* ───────────── Members: List ───────────── */

  async getTeamMembers(companyId: string, teamId: string): Promise<TeamMember[]> {
    await this.loadTeam(companyId, teamId);

    return this.teamMemberRepo.find({
      where: { teamId, companyId },
      relations: ['user'],
      order: { joinedAt: 'ASC' },
    });
  }

  /* ───────────── Employees: List ───────────── */

  async findAllEmployees(companyId: string, filters: EmployeeFilters = {}) {
    const { page = 1, limit = 25, search, role, isActive } = filters;

    const qb = this.userRepo
      .createQueryBuilder('user')
      .where('user.company_id = :companyId', { companyId });

    if (search) {
      qb.andWhere(
        '(LOWER(user.first_name) LIKE :search OR LOWER(user.last_name) LIKE :search OR LOWER(user.email) LIKE :search)',
        { search: `%${search.toLowerCase()}%` },
      );
    }

    if (role) {
      qb.andWhere('user.role = :role', { role });
    }

    if (isActive !== undefined) {
      qb.andWhere('user.is_active = :isActive', { isActive });
    }

    qb.orderBy('user.lastName', 'ASC')
      .addOrderBy('user.firstName', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /* ───────────── Employees: Update ───────────── */

  async updateEmployee(
    companyId: string,
    userId: string,
    dto: UpdateEmployeeDto,
  ): Promise<AppUser> {
    const user = await this.userRepo.findOne({
      where: { id: userId, companyId },
    });
    if (!user) throw new NotFoundError('AppUser', userId);

    if (dto.hourlyRateCents !== undefined) user.hourlyRateCents = dto.hourlyRateCents;
    if (dto.role !== undefined) user.role = dto.role;
    if (dto.licenceTier !== undefined) user.licenceTier = dto.licenceTier;
    if (dto.cctCode !== undefined) user.cctCode = dto.cctCode;
    if (dto.qualifications !== undefined) user.qualifications = dto.qualifications;
    if (dto.isActive !== undefined) {
      user.isActive = dto.isActive;
      user.deactivatedAt = dto.isActive ? null : new Date();
    }

    return this.userRepo.save(user);
  }
}
