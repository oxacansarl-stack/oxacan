import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SiteMeeting } from './entities/site-meeting.entity';
import { MeetingAttendee } from './entities/meeting-attendee.entity';
import { MeetingAction } from './entities/meeting-action.entity';
import { NotFoundError, BusinessRuleError } from '@oxacan/shared-types';

interface MeetingFilters {
  page?: number;
  limit?: number;
  projectId?: string;
  status?: string;
}

interface CreateMeetingDto {
  projectId: string;
  meetingDate: string;
  location?: string;
  agenda?: string;
}

interface UpdateMeetingDto {
  location?: string;
  agenda?: string;
  minutes?: string;
  status?: string;
}

interface AddAttendeeDto {
  name: string;
  role?: string;
  organization?: string;
  attendance?: string;
}

interface AddActionDto {
  description: string;
  responsible: string;
  dueDate?: string;
}

interface UpdateActionDto {
  description?: string;
  responsible?: string;
  dueDate?: string;
  status?: string;
}

@Injectable()
export class MeetingsService {
  constructor(
    @InjectRepository(SiteMeeting)
    private readonly meetingRepo: Repository<SiteMeeting>,
    @InjectRepository(MeetingAttendee)
    private readonly attendeeRepo: Repository<MeetingAttendee>,
    @InjectRepository(MeetingAction)
    private readonly actionRepo: Repository<MeetingAction>,
  ) {}

  /* ───────────── List ───────────── */

  async findAll(companyId: string, filters: MeetingFilters = {}) {
    const { page = 1, limit = 25, projectId, status } = filters;

    const qb = this.meetingRepo
      .createQueryBuilder('meeting')
      .leftJoinAndSelect('meeting.project', 'project')
      .where('meeting.company_id = :companyId', { companyId });

    if (projectId) {
      qb.andWhere('meeting.project_id = :projectId', { projectId });
    }
    if (status) {
      qb.andWhere('meeting.status = :status', { status });
    }

    qb.orderBy('meeting.meeting_date', 'DESC')
      .addOrderBy('meeting.meeting_number', 'DESC')
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
    const meeting = await this.meetingRepo.findOne({
      where: { id, companyId },
      relations: ['attendees', 'actions', 'project'],
    });
    if (!meeting) throw new NotFoundError('SiteMeeting', id);
    return meeting;
  }

  /* ───────────── Create ───────────── */

  async create(
    companyId: string,
    userId: string,
    dto: CreateMeetingDto,
  ): Promise<SiteMeeting> {
    // Auto-increment meetingNumber per project
    const lastMeeting = await this.meetingRepo
      .createQueryBuilder('meeting')
      .where('meeting.company_id = :companyId', { companyId })
      .andWhere('meeting.project_id = :projectId', { projectId: dto.projectId })
      .orderBy('meeting.meeting_number', 'DESC')
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

    return this.actionRepo.save(action);
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

    if (dto.description !== undefined) action.description = dto.description;
    if (dto.responsible !== undefined) action.responsible = dto.responsible;
    if (dto.dueDate !== undefined) action.dueDate = dto.dueDate ? (dto.dueDate as any) : null;
    if (dto.status !== undefined) action.status = dto.status;

    return this.actionRepo.save(action);
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
