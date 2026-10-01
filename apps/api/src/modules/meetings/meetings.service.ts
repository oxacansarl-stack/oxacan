import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { NotificationsService } from '../notifications/notifications.service';
import { SiteMeeting } from './entities/site-meeting.entity';
import { MeetingAttendee } from './entities/meeting-attendee.entity';
import { MeetingAction } from './entities/meeting-action.entity';
import { NotFoundError, BusinessRuleError } from '@oxacan/shared-types';
import {
  AddActionDto,
  AddAttendeeDto,
  CreateMeetingDto,
  UpdateActionDto,
  UpdateMeetingDto,
} from './dto/meeting.dto';
import { Project } from '../projects/entities/project.entity';

/** Meetings only need to identify their project — never expose its financials (budget, costs). */
const PROJECT_SUMMARY = ['project.id', 'project.reference', 'project.name', 'project.status'];

interface MeetingFilters {
  page?: number;
  limit?: number;
  projectId?: string;
  status?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class MeetingsService {
  constructor(
    @InjectRepository(SiteMeeting)
    private readonly meetingRepo: Repository<SiteMeeting>,
    @InjectRepository(MeetingAttendee)
    private readonly attendeeRepo: Repository<MeetingAttendee>,
    @InjectRepository(MeetingAction)
    private readonly actionRepo: Repository<MeetingAction>,
    @InjectRepository(Project)
    private readonly projectRepo: Repository<Project>,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * `responsible` is free text (a name or a trade); when it is the id of a user of the company,
   * that user is told about the action.
   */
  private async notifyResponsible(manager: EntityManager, companyId: string, action: MeetingAction) {
    if (!UUID_RE.test(action.responsible)) return;
    const [user] = await manager.query(
      'SELECT id FROM app_user WHERE id = $1 AND company_id = $2 AND deactivated_at IS NULL',
      [action.responsible, companyId],
    );
    if (!user) return;
    await this.notifications.createNotification(
      companyId,
      {
        userId: user.id,
        type: 'meeting_action_assigned',
        title: 'Une action de réunion de chantier vous a été attribuée',
        body: action.description,
        referenceType: 'meeting',
        referenceId: action.meetingId,
      },
      manager,
    );
  }

  /* ───────────── List ───────────── */

  async findAll(companyId: string, filters: MeetingFilters = {}) {
    const { page = 1, limit = 25, projectId, status } = filters;

    const qb = this.meetingRepo
      .createQueryBuilder('meeting')
      .leftJoin('meeting.project', 'project')
      .addSelect(PROJECT_SUMMARY)
      .where('meeting.company_id = :companyId', { companyId });

    if (projectId) {
      qb.andWhere('meeting.project_id = :projectId', { projectId });
    }
    if (status) {
      qb.andWhere('meeting.status = :status', { status });
    }

    qb.orderBy('meeting.meetingDate', 'DESC')
      .addOrderBy('meeting.meetingNumber', 'DESC')
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

  /* ───────────── Find by ID ───────────── */

  async findById(companyId: string, id: string): Promise<SiteMeeting> {
    const meeting = await this.meetingRepo
      .createQueryBuilder('meeting')
      .leftJoinAndSelect('meeting.attendees', 'attendees')
      .leftJoinAndSelect('meeting.actions', 'actions')
      .leftJoin('meeting.project', 'project')
      .addSelect(PROJECT_SUMMARY)
      .where('meeting.id = :id', { id })
      .andWhere('meeting.company_id = :companyId', { companyId })
      .getOne();
    if (!meeting) throw new NotFoundError('SiteMeeting', id);
    return meeting;
  }

  /* ───────────── Create ───────────── */

  async create(
    companyId: string,
    userId: string,
    dto: CreateMeetingDto,
  ): Promise<SiteMeeting> {
    // The project must belong to the caller's company
    const project = await this.projectRepo.findOne({
      where: { id: dto.projectId, companyId },
      select: ['id'],
    });
    if (!project) throw new NotFoundError('Project', dto.projectId);

    // Auto-increment meetingNumber per project
    const lastMeeting = await this.meetingRepo
      .createQueryBuilder('meeting')
      .where('meeting.company_id = :companyId', { companyId })
      .andWhere('meeting.project_id = :projectId', { projectId: dto.projectId })
      .orderBy('meeting.meetingNumber', 'DESC')
      .getOne();

    const meetingNumber = lastMeeting ? lastMeeting.meetingNumber + 1 : 1;

    const meeting = this.meetingRepo.create({
      companyId,
      projectId: dto.projectId,
      meetingNumber,
      meetingDate: dto.meetingDate as any,
      location: dto.location || null,
      agenda: dto.agenda || null,
      status: 'scheduled',
      createdById: userId,
    });

    const saved = await this.meetingRepo.save(meeting);
    return this.findById(companyId, saved.id);
  }

  /* ───────────── Update ───────────── */

  async update(
    companyId: string,
    id: string,
    dto: UpdateMeetingDto,
  ): Promise<SiteMeeting> {
    const meeting = await this.findById(companyId, id);

    if (meeting.status === 'completed') {
      throw new BusinessRuleError(
        'MEETING_COMPLETED',
        'Cannot modify a completed meeting.',
      );
    }

    if (dto.location !== undefined) meeting.location = dto.location || null;
    if (dto.agenda !== undefined) meeting.agenda = dto.agenda || null;
    if (dto.minutes !== undefined) meeting.minutes = dto.minutes || null;
    if (dto.status !== undefined) meeting.status = dto.status;

    await this.meetingRepo.save(meeting);
    return this.findById(companyId, id);
  }

  /* ───────────── Attendees: Add ───────────── */

  async addAttendee(
    companyId: string,
    meetingId: string,
    dto: AddAttendeeDto,
  ): Promise<MeetingAttendee> {
    await this.findById(companyId, meetingId);

    const attendee = this.attendeeRepo.create({
      meetingId,
      companyId,
      name: dto.name,
      role: dto.role || null,
      organization: dto.organization || null,
      attendance: dto.attendance || 'present',
    });

    return this.attendeeRepo.save(attendee);
  }

  /* ───────────── Attendees: Remove ───────────── */

  async removeAttendee(
    companyId: string,
    meetingId: string,
    attendeeId: string,
  ): Promise<void> {
    await this.findById(companyId, meetingId);

    const attendee = await this.attendeeRepo.findOne({
      where: { id: attendeeId, meetingId, companyId },
    });
    if (!attendee) throw new NotFoundError('MeetingAttendee', attendeeId);

    await this.attendeeRepo.remove(attendee);
  }

  /* ───────────── Actions: Add ───────────── */

  async addAction(
    companyId: string,
    meetingId: string,
    dto: AddActionDto,
  ): Promise<MeetingAction> {
    await this.findById(companyId, meetingId);

    const action = this.actionRepo.create({
      meetingId,
      companyId,
      description: dto.description,
      responsible: dto.responsible,
      dueDate: dto.dueDate ? (dto.dueDate as any) : null,
      status: 'open',
    });

    return this.actionRepo.manager.transaction(async (m) => {
      const saved = await m.save(action);
      await this.notifyResponsible(m, companyId, saved);
      return saved;
    });
  }

  /* ───────────── Actions: Update ───────────── */

  async updateAction(
    companyId: string,
    meetingId: string,
    actionId: string,
    dto: UpdateActionDto,
  ): Promise<MeetingAction> {
    await this.findById(companyId, meetingId);

    const action = await this.actionRepo.findOne({
      where: { id: actionId, meetingId, companyId },
    });
    if (!action) throw new NotFoundError('MeetingAction', actionId);

    const reassigned = dto.responsible !== undefined && dto.responsible !== action.responsible;
    if (dto.description !== undefined) action.description = dto.description;
    if (dto.responsible !== undefined) action.responsible = dto.responsible;
    if (dto.dueDate !== undefined) action.dueDate = dto.dueDate ? (dto.dueDate as any) : null;
    if (dto.status !== undefined) action.status = dto.status;

    return this.actionRepo.manager.transaction(async (m) => {
      const saved = await m.save(action);
      if (reassigned) await this.notifyResponsible(m, companyId, saved);
      return saved;
    });
  }

  /* ───────────── Complete Meeting ───────────── */

  async completeMeeting(companyId: string, id: string): Promise<SiteMeeting> {
    const meeting = await this.findById(companyId, id);

    if (meeting.status === 'completed') {
      throw new BusinessRuleError(
        'ALREADY_COMPLETED',
        'This meeting is already completed.',
      );
    }

    meeting.status = 'completed';
    await this.meetingRepo.save(meeting);

    return this.findById(companyId, id);
  }
}
