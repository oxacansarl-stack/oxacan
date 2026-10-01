import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, QueryFailedError, Repository } from 'typeorm';
import { BusinessRuleError, NotFoundError, OxacanError } from '@oxacan/shared-types';
import { AppUser } from '../auth/entities/app-user.entity';
import { Company } from '../company/entities/company.entity';
import { SubscriptionService } from '../subscription/subscription.service';
import { runAsSystem } from '../../common/tenant/tenant-context';
import { Team } from './entities/team.entity';
import { TeamMember } from './entities/team-member.entity';
import { CreateEmployeeDto, normalizeEmail } from './dto/hr.dto';
import { AuthEmailExistsError, SupabaseAdminService } from './supabase-admin.service';

/** First key of pg_advisory_xact_lock(int, int); the second is the company. */
const SEAT_LOCK_NAMESPACE = 0x5ea7;

const OFFICE_ROLES = new Set(['ADMIN', 'PROJECT_MANAGER']);

const asDate = (v: string | null | undefined): Date | null => (v ? (v as unknown as Date) : null);

/**
 * Creating, inviting, deactivating and reactivating employee accounts (PRD §18.2, §19.1).
 *
 * Every active user takes a subscription seat. Anything that adds an active user runs through
 * withFreeSeat(), which holds a per-company advisory lock for the whole transaction, so two
 * concurrent requests can never both take the last seat.
 */
@Injectable()
export class EmployeeAccountsService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(AppUser)
    private readonly userRepo: Repository<AppUser>,
    @InjectRepository(Team)
    private readonly teamRepo: Repository<Team>,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    private readonly subscriptions: SubscriptionService,
    private readonly supabase: SupabaseAdminService,
  ) {}

  /**
   * Runs fn in a transaction that holds the company's seat lock, once a seat is known to be free.
   * checkSeatAvailability reads on its own connection, so it sees committed rows only; that is
   * accurate because every seat-taking change commits before it releases the lock.
   */
  async withFreeSeat<T>(companyId: string, fn: (m: EntityManager) => Promise<T>): Promise<T> {
    try {
      return await this.dataSource.transaction(async (m) => {
        // Bounded wait: waiters hold a pooled connection, so they must not queue forever.
        await m.query(`SET LOCAL lock_timeout = '10s'`);
        await m.query('SELECT pg_advisory_xact_lock($1::int, hashtext($2::text))', [SEAT_LOCK_NAMESPACE, companyId]);
        const seats = await this.subscriptions.checkSeatAvailability(companyId);
        if (seats.available < 1) {
          throw new BusinessRuleError(
            'SEAT_LIMIT_REACHED',
            seats.total === 0
              ? 'The company has no subscription seats. Add seats to the subscription before adding users.'
              : `All ${seats.total} subscription seat(s) are in use. Deactivate a user or add seats first.`,
            { used: seats.used, total: seats.total },
          );
        }
        return fn(m);
      });
    } catch (err) {
      if (err instanceof QueryFailedError && (err as any).driverError?.code === '55P03') {
        throw new OxacanError('BUSY', 'Another change to this company’s users is in progress. Try again.', 409);
      }
      throw err;
    }
  }

  /* ───────────── Create + invite ───────────── */

  /**
   * Creates the employee and emails them a Supabase invitation, linking the returned auth user.
   * The invite is sent inside the transaction, before the row is written: if Supabase fails, the
   * transaction rolls back and nothing exists. If the commit fails after Supabase accepted the
   * invite, retrying is safe because Supabase returns the same, still unconfirmed, auth user.
   */
  async createEmployee(companyId: string, dto: CreateEmployeeDto): Promise<AppUser> {
    this.supabase.assertConfigured();
    const email = normalizeEmail(dto.email);

    if (dto.teamId) {
      const team = await this.teamRepo.findOne({ where: { id: dto.teamId, companyId } });
      if (!team) throw new NotFoundError('Team', dto.teamId);
    }
    await this.assertNoEmployeeWithEmail(companyId, email);
    await this.assertNotRegisteredElsewhere(companyId, email);
    const company = await this.companyRepo.findOne({ where: { id: companyId } });

    return this.withFreeSeat(companyId, async (m) => {
      // Again under the lock, so a concurrent request for the same email gets no second invite.
      await this.assertNoEmployeeWithEmail(companyId, email);
      const authUser = await this.invite(email, {
        first_name: dto.firstName,
        last_name: dto.lastName,
        company_name: company?.name ?? null,
      });

      const user = await m.save(
        m.create(AppUser, {
          companyId,
          supabaseAuthId: authUser.id,
          email,
          firstName: dto.firstName,
          lastName: dto.lastName,
          phone: dto.phone || null,
          role: dto.role,
          licenceTier: dto.licenceTier ?? (OFFICE_ROLES.has(dto.role) ? 'application' : 'saas'),
          hourlyRateCents: dto.hourlyRateCents ?? null,
          cctCode: dto.cctCode || null,
          hireDate: asDate(dto.hireDate),
          qualifications: dto.qualifications ?? [],
          isActive: true,
          deactivatedAt: null,
        }),
      );
      if (dto.teamId) {
        await m.insert(TeamMember, { teamId: dto.teamId, userId: user.id, companyId });
      }
      return user;
    });
  }

  /** One email per company. */
  private async assertNoEmployeeWithEmail(companyId: string, email: string): Promise<void> {
    const existing = await this.userRepo
      .createQueryBuilder('user')
      .where('user.company_id = :companyId', { companyId })
      .andWhere('LOWER(user.email) = :email', { email })
      .getOne();
    if (existing) {
      throw new BusinessRuleError(
        'EMAIL_TAKEN',
        existing.isActive
          ? 'An employee with this email already exists.'
          : 'A deactivated employee with this email already exists. Reactivate them instead.',
        { existingUserId: existing.id, isActive: existing.isActive },
      );
    }
  }

  /** One OXACAN account per Supabase login (supabase_auth_id is unique across companies). */
  private async assertNotRegisteredElsewhere(companyId: string, email: string): Promise<void> {
    // Other companies' users are invisible under RLS; this existence check is the only bypass.
    const elsewhere = await runAsSystem(() =>
      this.userRepo
        .createQueryBuilder('user')
        .where('user.company_id <> :companyId', { companyId })
        .andWhere('LOWER(user.email) = :email', { email })
        .getExists(),
    );
    if (elsewhere) throw emailAlreadyRegistered();
  }

  private async invite(email: string, metadata: Record<string, unknown>) {
    try {
      return await this.supabase.inviteUserByEmail(email, metadata);
    } catch (err) {
      if (err instanceof AuthEmailExistsError) throw emailAlreadyRegistered();
      throw err;
    }
  }

  /* ───────────── Resend invite ───────────── */

  /**
   * Sends the invitation again (also the retry path for an account whose invite never went out).
   * Supabase refuses once the person has accepted: they should sign in, or reset their password.
   */
  async resendInvite(companyId: string, userId: string): Promise<AppUser> {
    this.supabase.assertConfigured();
    const user = await this.load(companyId, userId);
    if (!user.isActive) {
      throw new BusinessRuleError('USER_INACTIVE', 'Reactivate this employee before sending an invitation.');
    }

    let authUser;
    try {
      authUser = await this.supabase.inviteUserByEmail(normalizeEmail(user.email), {
        first_name: user.firstName,
        last_name: user.lastName,
      });
    } catch (err) {
      if (err instanceof AuthEmailExistsError) {
        throw new BusinessRuleError(
          'INVITE_ALREADY_ACCEPTED',
          'This employee has already activated their account and can sign in.',
        );
      }
      throw err;
    }

    // Supabase returns the one auth user for this email; link it if the row was not linked yet
    // (or still points at a placeholder id). The unique constraint rejects a user linked elsewhere.
    if (user.supabaseAuthId !== authUser.id) {
      user.supabaseAuthId = authUser.id;
      await this.userRepo.update({ id: user.id, companyId }, { supabaseAuthId: authUser.id });
    }
    return user;
  }

  /* ───────────── Deactivate / reactivate ───────────── */

  /** PRD §18.2: deactivation, never deletion; the seat is freed immediately and API access stops. */
  async deactivate(companyId: string, userId: string, actorId?: string): Promise<AppUser> {
    if (actorId && actorId === userId) {
      throw new BusinessRuleError('CANNOT_DEACTIVATE_SELF', 'You cannot deactivate your own account.');
    }
    const user = await this.load(companyId, userId);
    if (!user.isActive) return user;
    user.isActive = false;
    user.deactivatedAt = new Date();
    await this.userRepo.update({ id: user.id, companyId }, { isActive: false, deactivatedAt: user.deactivatedAt });
    return user;
  }

  /** Reactivating takes a seat again, so it is checked like a new user. */
  async reactivate(companyId: string, userId: string): Promise<AppUser> {
    const user = await this.load(companyId, userId);
    if (user.isActive) return user;
    return this.withFreeSeat(companyId, async (m) => {
      user.isActive = true;
      user.deactivatedAt = null;
      await m.update(AppUser, { id: user.id, companyId }, { isActive: true, deactivatedAt: null });
      return user;
    });
  }

  private async load(companyId: string, userId: string): Promise<AppUser> {
    const user = await this.userRepo.findOne({ where: { id: userId, companyId } });
    if (!user) throw new NotFoundError('AppUser', userId);
    return user;
  }
}

function emailAlreadyRegistered(): BusinessRuleError {
  return new BusinessRuleError(
    'EMAIL_ALREADY_REGISTERED',
    'This email address is already used by another OXACAN account and cannot be invited.',
  );
}
