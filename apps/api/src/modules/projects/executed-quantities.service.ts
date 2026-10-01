import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { BusinessRuleError, NotFoundError, ValidationError } from '@oxacan/shared-types';
import { assertProjectExists } from '../../common/util/assert-project';
import { AccessScopeService, ScopeUser } from '../timekeeping/access-scope.service';
import { ExecutedQuantity } from './entities/executed-quantity.entity';
import { EXECUTED_QUANTITY_VARIANTS, roundExecutedQuantity as round } from './executed-quantities';
import {
  CorrectExecutedQuantityDto,
  RecordExecutedQuantityDto,
  ValidateExecutedQuantitiesDto,
} from './dto/executed-quantity.dto';

/** Roles that record, correct and see executed quantities on every project of the company. */
const OFFICE = ['ADMIN', 'PROJECT_MANAGER'];
const STATUSES = ['pending', 'validated'];

/** One offer position of a project with its executed quantities. */
export interface ExecutedPosition {
  offerLineId: string;
  positionNumber: number;
  description: string;
  unit: string;
  variantType: string;
  /** Quantity in the offer (the budget). */
  offerQuantity: number;
  /** Sum of every entry, validated or not. */
  recordedQuantity: number;
  /** Sum of the validated entries: what a situation may bill to date. */
  validatedQuantity: number;
  /** recordedQuantity − validatedQuantity. */
  pendingQuantity: number;
  pendingEntries: number;
  lastRecordedAt: Date | null;
}

interface EntryFilters {
  offerLineId?: string;
  status?: string;
  page?: number;
  limit?: number;
}

/**
 * Executed quantities per offer position (PRD §10 field operations, §15.2 situations on executed
 * quantities). An append-only ledger: team leaders and project managers record entries (a delta or
 * the cumulative measured on site), mistakes are fixed with correction entries, and a project
 * manager validates entries before they count as billable.
 *
 * Project access: ADMIN / PROJECT_MANAGER on every project; a TEAM_LEADER only on projects they
 * are assigned to — a task of the project is assigned to them or to a member of a team they lead
 * (the team-leader scope of AccessScopeService).
 */
@Injectable()
export class ExecutedQuantitiesService {
  constructor(
    @InjectRepository(ExecutedQuantity)
    private readonly entryRepo: Repository<ExecutedQuantity>,
    private readonly dataSource: DataSource,
    private readonly scope: AccessScopeService,
  ) {}

  /* ───────────── Access ───────────── */

  /** 404 outside the company; 403 for a team leader not assigned to the project or a lower role. */
  async assertCanAccessProject(user: ScopeUser, projectId: string): Promise<void> {
    await assertProjectExists(this.dataSource.manager, user.companyId, projectId);
    if (OFFICE.includes(user.role)) return;
    if (user.role !== 'TEAM_LEADER') throw new ForbiddenException('Insufficient role');
    if (!(await this.isAssigned(user, projectId))) {
      throw new ForbiddenException('A team leader may only work on executed quantities of projects they are assigned to.');
    }
  }

  /** A task of the project is assigned to the team leader or to a member of a team they lead. */
  private async isAssigned(user: ScopeUser, projectId: string): Promise<boolean> {
    const users = (await this.scope.visibleUserIds(user)) ?? [user.id];
    const [row] = await this.dataSource.query(
      `SELECT 1 FROM task WHERE company_id = $1 AND project_id = $2 AND assigned_to = ANY($3::uuid[]) LIMIT 1`,
      [user.companyId, projectId, users],
    );
    return !!row;
  }

  /* ───────────── Read ───────────── */

  /** Cumulative executed quantity of each priced position of the project's contracted offer. */
  async getPositions(user: ScopeUser, projectId: string): Promise<ExecutedPosition[]> {
    await this.assertCanAccessProject(user, projectId);
    return this.positions(this.dataSource.manager, user.companyId, projectId);
  }

  async listEntries(user: ScopeUser, projectId: string, filters: EntryFilters = {}) {
    await this.assertCanAccessProject(user, projectId);
    const { page = 1, limit = 50, offerLineId, status } = filters;
    if (status !== undefined && !STATUSES.includes(status)) {
      throw new ValidationError(`status must be one of: ${STATUSES.join(', ')}`);
    }

    const qb = this.entryRepo
      .createQueryBuilder('eq')
      .leftJoin('eq.recordedBy', 'recordedBy')
      .addSelect(['recordedBy.id', 'recordedBy.firstName', 'recordedBy.lastName'])
      .leftJoin('eq.validatedBy', 'validatedBy')
      .addSelect(['validatedBy.id', 'validatedBy.firstName', 'validatedBy.lastName'])
      .where('eq.company_id = :companyId', { companyId: user.companyId })
      .andWhere('eq.project_id = :projectId', { projectId });
    if (offerLineId) qb.andWhere('eq.offer_line_id = :offerLineId', { offerLineId });
    if (status === 'pending') qb.andWhere('eq.validated_at IS NULL');
    if (status === 'validated') qb.andWhere('eq.validated_at IS NOT NULL');

    qb.orderBy('eq.recordedAt', 'DESC')
      .addOrderBy('eq.createdAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);
    const [data, total] = await qb.getManyAndCount();
    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  /* ───────────── Record ───────────── */

  async record(user: ScopeUser, projectId: string, dto: RecordExecutedQuantityDto): Promise<ExecutedQuantity> {
    if ((dto.quantity == null) === (dto.cumulativeQuantity == null)) {
      throw new ValidationError('Give either quantity (executed since the last entry) or cumulativeQuantity (total to date).');
    }
    await this.assertCanAccessProject(user, projectId);
    const { companyId } = user;

    return this.dataSource.transaction(async (m) => {
      await this.lockProject(m, projectId);
      const [position] = await this.positions(m, companyId, projectId, [dto.offerLineId]);
      if (!position) {
        throw new BusinessRuleError(
          'OFFER_LINE_NOT_IN_PROJECT',
          'Executed quantities can only be recorded on priced work positions of the offer contracted for this project.',
        );
      }
      if (dto.dailyReportId) await this.assertDailyReport(m, user, projectId, dto.dailyReportId);
      if (dto.taskId) await this.assertTask(m, companyId, projectId, dto.taskId);

      const recorded = position.recordedQuantity;
      let delta: number;
      if (dto.quantity != null) {
        delta = round(dto.quantity);
        if (delta <= 0) throw new ValidationError('quantity must be greater than 0.');
      } else {
        delta = round(dto.cumulativeQuantity! - recorded);
        if (delta <= 0) {
          throw new BusinessRuleError(
            'CUMULATIVE_NOT_ABOVE_RECORDED',
            `Position ${position.positionNumber} already has ${recorded} recorded; a cumulative quantity must be higher. To lower it, correct the entry that was wrong.`,
          );
        }
      }

      return m.save(
        m.create(ExecutedQuantity, {
          companyId,
          projectId,
          offerLineId: dto.offerLineId,
          entryType: dto.quantity != null ? 'delta' : 'cumulative',
          quantityDelta: delta,
          cumulativeQuantity: round(recorded + delta),
          correctsEntryId: null,
          dailyReportId: dto.dailyReportId ?? null,
          taskId: dto.taskId ?? null,
          note: dto.note?.trim() || null,
          recordedById: user.id,
        }),
      );
    });
  }

  /* ───────────── Correct ───────────── */

  /** Adds a correction entry so that `entryId` (with its earlier corrections) adds `correctedQuantity`. */
  async correct(
    user: ScopeUser,
    projectId: string,
    entryId: string,
    dto: CorrectExecutedQuantityDto,
  ): Promise<ExecutedQuantity> {
    const note = dto.note.trim();
    if (!note) throw new ValidationError('A correction needs a note explaining it.');
    await this.assertCanAccessProject(user, projectId);
    const { companyId } = user;

    return this.dataSource.transaction(async (m) => {
      await this.lockProject(m, projectId);
      const target = await m.findOne(ExecutedQuantity, { where: { id: entryId, companyId, projectId } });
      if (!target) throw new NotFoundError('ExecutedQuantity', entryId);
      if (target.entryType === 'correction') {
        throw new BusinessRuleError('CANNOT_CORRECT_A_CORRECTION', 'Correct the original entry instead of a correction.');
      }

      const [{ effective }] = await m.query(
        `SELECT COALESCE(SUM(quantity_delta), 0) AS effective FROM executed_quantity
          WHERE company_id = $1 AND (id = $2 OR corrects_entry_id = $2)`,
        [companyId, target.id],
      );
      const delta = round(dto.correctedQuantity - Number(effective));
      if (delta === 0) {
        throw new BusinessRuleError('NOTHING_TO_CORRECT', `This entry already adds ${Number(effective)}.`);
      }
      const recorded = await this.recordedTotal(m, companyId, projectId, target.offerLineId);
      const cumulative = round(recorded + delta);
      if (cumulative < 0) {
        throw new BusinessRuleError('NEGATIVE_EXECUTED_QUANTITY', 'The position\'s executed quantity cannot go below 0.');
      }

      return m.save(
        m.create(ExecutedQuantity, {
          companyId,
          projectId,
          offerLineId: target.offerLineId,
          entryType: 'correction',
          quantityDelta: delta,
          cumulativeQuantity: cumulative,
          correctsEntryId: target.id,
          dailyReportId: null,
          taskId: target.taskId,
          note,
          recordedById: user.id,
        }),
      );
    });
  }

  /* ───────────── Validate (project manager) ───────────── */

  /**
   * Validates pending entries: from then on they count towards the position's billable quantity.
   * A correction is validated only with or after the entry it corrects; a batch may not leave a
   * position's validated quantity below 0. All-or-nothing.
   */
  async validate(user: ScopeUser, projectId: string, dto: ValidateExecutedQuantitiesDto) {
    if (!OFFICE.includes(user.role)) {
      throw new ForbiddenException('Only a project manager validates executed quantities.');
    }
    await assertProjectExists(this.dataSource.manager, user.companyId, projectId);
    const { companyId } = user;
    const ids = [...new Set(dto.entryIds)];

    return this.dataSource.transaction(async (m) => {
      await this.lockProject(m, projectId);
      const entries = await m.find(ExecutedQuantity, { where: { companyId, projectId, id: In(ids) } });
      const found = new Set(entries.map((e) => e.id));
      const missing = ids.find((id) => !found.has(id));
      if (missing) throw new NotFoundError('ExecutedQuantity', missing);
      if (entries.some((e) => e.validatedAt)) {
        throw new BusinessRuleError('EXECUTED_QUANTITY_ALREADY_VALIDATED', 'Some of these entries are already validated.');
      }

      const targetIds = [...new Set(entries.map((e) => e.correctsEntryId).filter((id): id is string => !!id))]
        .filter((id) => !found.has(id));
      if (targetIds.length) {
        const pendingTargets: { id: string }[] = await m.query(
          `SELECT id FROM executed_quantity WHERE company_id = $1 AND id = ANY($2::uuid[]) AND validated_at IS NULL`,
          [companyId, targetIds],
        );
        if (pendingTargets.length) {
          throw new BusinessRuleError(
            'CORRECTED_ENTRY_NOT_VALIDATED',
            'A correction can only be validated with or after the entry it corrects.',
          );
        }
      }

      const offerLineIds = [...new Set(entries.map((e) => e.offerLineId))];
      const added = new Map<string, number>();
      for (const e of entries) added.set(e.offerLineId, (added.get(e.offerLineId) ?? 0) + e.quantityDelta);
      const validatedNow: { offer_line_id: string; validated: string }[] = await m.query(
        `SELECT offer_line_id, COALESCE(SUM(quantity_delta), 0) AS validated FROM executed_quantity
          WHERE company_id = $1 AND project_id = $2 AND offer_line_id = ANY($3::uuid[]) AND validated_at IS NOT NULL
          GROUP BY offer_line_id`,
        [companyId, projectId, offerLineIds],
      );
      const current = new Map(validatedNow.map((r) => [r.offer_line_id, Number(r.validated)]));
      if (offerLineIds.some((id) => round((current.get(id) ?? 0) + added.get(id)!) < 0)) {
        throw new BusinessRuleError(
          'NEGATIVE_EXECUTED_QUANTITY',
          'Validating these entries would bring a position\'s validated quantity below 0; validate the entries they correct too.',
        );
      }

      const updated: { id: string }[] = await m.query(
        `UPDATE executed_quantity SET validated_at = NOW(), validated_by = $3
          WHERE company_id = $1 AND id = ANY($2::uuid[]) AND validated_at IS NULL
          RETURNING id`,
        [companyId, ids, user.id],
      );
      return {
        validated: updated.length,
        positions: await this.positions(m, companyId, projectId, offerLineIds),
      };
    });
  }

  /* ───────────── Internals ───────────── */

  /** Serialises ledger writes of a project, so running totals and validation checks hold. */
  private async lockProject(m: EntityManager, projectId: string): Promise<void> {
    await m.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`executed_quantity:${projectId}`]);
  }

  private async recordedTotal(m: EntityManager, companyId: string, projectId: string, offerLineId: string): Promise<number> {
    const [{ total }] = await m.query(
      `SELECT COALESCE(SUM(quantity_delta), 0) AS total FROM executed_quantity
        WHERE company_id = $1 AND project_id = $2 AND offer_line_id = $3`,
      [companyId, projectId, offerLineId],
    );
    return round(Number(total));
  }

  private async assertDailyReport(m: EntityManager, user: ScopeUser, projectId: string, id: string): Promise<void> {
    const [report]: { user_id: string; project_id: string }[] = await m.query(
      `SELECT user_id, project_id FROM daily_report WHERE company_id = $1 AND id = $2`,
      [user.companyId, id],
    );
    if (!report || !(await this.scope.canSee(user, report.user_id))) throw new NotFoundError('DailyReport', id);
    if (report.project_id !== projectId) {
      throw new BusinessRuleError('DAILY_REPORT_NOT_IN_PROJECT', 'The daily report belongs to another project.');
    }
  }

  private async assertTask(m: EntityManager, companyId: string, projectId: string, id: string): Promise<void> {
    const [task]: { project_id: string }[] = await m.query(
      `SELECT project_id FROM task WHERE company_id = $1 AND id = $2`,
      [companyId, id],
    );
    if (!task) throw new NotFoundError('Task', id);
    if (task.project_id !== projectId) {
      throw new BusinessRuleError('TASK_NOT_IN_PROJECT', 'The task belongs to another project.');
    }
  }

  /** Priced positions of the project's contracted offer with their ledger totals. */
  private async positions(
    m: EntityManager,
    companyId: string,
    projectId: string,
    offerLineIds?: string[],
  ): Promise<ExecutedPosition[]> {
    const rows: {
      id: string; position_number: number; description: string; unit: string; variant_type: string;
      offer_quantity: string; recorded: string; validated: string; pending_entries: string; last_recorded_at: Date | null;
    }[] = await m.query(
      `SELECT ol.id, ol.position_number, ol.description, ol.unit, ol.variant_type,
              ol.quantity::numeric AS offer_quantity,
              COALESCE(SUM(eq.quantity_delta), 0) AS recorded,
              COALESCE(SUM(eq.quantity_delta) FILTER (WHERE eq.validated_at IS NOT NULL), 0) AS validated,
              COUNT(eq.id) FILTER (WHERE eq.validated_at IS NULL) AS pending_entries,
              MAX(eq.recorded_at) AS last_recorded_at
         FROM project p
         JOIN contract c ON c.company_id = p.company_id AND c.id = p.contract_id
         JOIN offer o ON o.company_id = c.company_id AND o.id = c.offer_id
         JOIN offer_line ol ON ol.company_id = o.company_id AND ol.offer_id = o.id
         LEFT JOIN executed_quantity eq
           ON eq.company_id = p.company_id AND eq.project_id = p.id AND eq.offer_line_id = ol.id
        WHERE p.company_id = $1 AND p.id = $2 AND ol.variant_type = ANY($3::text[])
          AND ($4::uuid[] IS NULL OR ol.id = ANY($4::uuid[]))
        GROUP BY ol.id
        ORDER BY ol.sort_order, ol.position_number`,
      [companyId, projectId, EXECUTED_QUANTITY_VARIANTS, offerLineIds ?? null],
    );
    return rows.map((r) => {
      const recorded = round(Number(r.recorded));
      const validated = round(Number(r.validated));
      return {
        offerLineId: r.id,
        positionNumber: r.position_number,
        description: r.description,
        unit: r.unit,
        variantType: r.variant_type,
        offerQuantity: Number(r.offer_quantity),
        recordedQuantity: recorded,
        validatedQuantity: validated,
        pendingQuantity: round(recorded - validated),
        pendingEntries: Number(r.pending_entries),
        lastRecordedAt: r.last_recorded_at,
      };
    });
  }
}
