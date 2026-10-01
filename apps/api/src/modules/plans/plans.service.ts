import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Plan } from './entities/plan.entity';
import { PlanAnnotation } from './entities/plan-annotation.entity';
import { PlanFile } from './entities/plan-file.entity';
import { NotFoundError, ValidationError } from '@oxacan/shared-types';
import {
  CreatePlanDto,
  UpdatePlanDto,
  CreateAnnotationDto,
  PLAN_FILE_MAX_BYTES,
  PLAN_UPLOAD_TYPES,
  PlanUploadType,
} from './dto/plan.dto';

/** Leading bytes each accepted content type must start with. */
const FILE_SIGNATURES: Record<PlanUploadType, Buffer> = {
  'application/pdf': Buffer.from('%PDF-', 'latin1'),
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff]),
};

export interface PlanFileInfo {
  planId: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  uploadedAt: Date;
}

interface PlanFilters {
  projectId?: string;
  offerId?: string;
  floor?: string;
}

@Injectable()
export class PlansService {
  constructor(
    @InjectRepository(Plan)
    private readonly planRepo: Repository<Plan>,
    @InjectRepository(PlanAnnotation)
    private readonly annotationRepo: Repository<PlanAnnotation>,
    @InjectRepository(PlanFile)
    private readonly fileRepo: Repository<PlanFile>,
  ) {}

  async findAll(companyId: string, filters: PlanFilters = {}) {
    const { projectId, offerId, floor } = filters;

    const qb = this.planRepo
      .createQueryBuilder('plan')
      .where('plan.company_id = :companyId', { companyId });

    if (projectId) {
      qb.andWhere('plan.project_id = :projectId', { projectId });
    }

    if (offerId) {
      qb.andWhere('plan.offer_id = :offerId', { offerId });
    }

    if (floor) {
      qb.andWhere('plan.floor = :floor', { floor });
    }

    qb.orderBy('plan.createdAt', 'DESC');

    return qb.getMany();
  }

  async findById(companyId: string, id: string): Promise<Plan> {
    const plan = await this.planRepo.findOne({
      where: { id, companyId },
      relations: ['annotations'],
    });
    if (!plan) throw new NotFoundError('Plan', id);
    return plan;
  }

  async create(companyId: string, data: CreatePlanDto): Promise<Plan> {
    const plan = this.planRepo.create({
      ...data,
      companyId,
    });
    return this.planRepo.save(plan);
  }

  async update(
    companyId: string,
    id: string,
    data: UpdatePlanDto,
  ): Promise<Plan> {
    const plan = await this.findById(companyId, id);
    Object.assign(plan, data);
    return this.planRepo.save(plan);
  }

  async delete(companyId: string, id: string): Promise<void> {
    const plan = await this.findById(companyId, id);
    await this.planRepo.remove(plan);
  }

  async addAnnotation(
    companyId: string,
    planId: string,
    data: CreateAnnotationDto,
  ): Promise<PlanAnnotation> {
    // Ensure plan exists and belongs to company
    await this.findById(companyId, planId);
    if (data.type === 'symbol') assertSymbolGeometry(data.geometry);

    const annotation = this.annotationRepo.create({
      ...data,
      planId,
      companyId,
    });
    return this.annotationRepo.save(annotation);
  }

  async removeAnnotation(
    companyId: string,
    planId: string,
    annotationId: string,
  ): Promise<void> {
    // Ensure plan exists and belongs to company
    await this.findById(companyId, planId);

    const annotation = await this.annotationRepo.findOne({
      where: { id: annotationId, planId, companyId },
    });
    if (!annotation) throw new NotFoundError('PlanAnnotation', annotationId);

    await this.annotationRepo.remove(annotation);
  }

  /** 404 unless the plan exists in this company (checked before an upload body is read). */
  async assertExists(companyId: string, id: string): Promise<void> {
    if (!(await this.planRepo.exists({ where: { id, companyId } }))) throw new NotFoundError('Plan', id);
  }

  /**
   * Stores (or replaces) the plan's file. The content must really be the declared type, and the
   * plan's file type and size follow the stored file.
   */
  async uploadFile(
    companyId: string,
    planId: string,
    userId: string,
    contentType: PlanUploadType,
    data: Buffer,
  ): Promise<PlanFileInfo> {
    await this.assertExists(companyId, planId);
    if (data.length === 0) throw new ValidationError('The uploaded file is empty.');
    if (data.length > PLAN_FILE_MAX_BYTES) {
      throw new ValidationError(`The file exceeds ${PLAN_FILE_MAX_BYTES} bytes.`, { maxBytes: PLAN_FILE_MAX_BYTES });
    }
    const signature = FILE_SIGNATURES[contentType];
    if (data.length < signature.length || !data.subarray(0, signature.length).equals(signature)) {
      throw new ValidationError(`The file content is not a valid ${PLAN_UPLOAD_TYPES[contentType].toUpperCase()} file.`, { contentType });
    }

    const info: PlanFileInfo = {
      planId,
      contentType,
      sizeBytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
      uploadedAt: new Date(),
    };
    await this.planRepo.manager.transaction(async (m) => {
      await m.upsert(PlanFile, { ...info, companyId, data, uploadedBy: userId }, ['planId']);
      await m.update(
        Plan,
        { id: planId, companyId },
        { fileType: PLAN_UPLOAD_TYPES[contentType], fileSizeBytes: data.length, uploadedBy: userId },
      );
    });
    return info;
  }

  /** The stored file with its bytes, plus the plan name for the download filename. */
  async getFile(companyId: string, planId: string): Promise<{ file: PlanFile; planName: string }> {
    const plan = await this.planRepo.findOne({ where: { id: planId, companyId }, select: { id: true, name: true } });
    if (!plan) throw new NotFoundError('Plan', planId);
    const file = await this.fileRepo
      .createQueryBuilder('f')
      .addSelect('f.data')
      .where('f.plan_id = :planId AND f.company_id = :companyId', { planId, companyId })
      .getOne();
    if (!file) throw new NotFoundError('PlanFile', planId);
    return { file, planName: plan.name };
  }
}

/** A symbol is a detected box: geometry.bbox = [x0, y0, x1, y1] in plan coordinates. */
function assertSymbolGeometry(geometry: Record<string, unknown>) {
  const bbox = geometry.bbox;
  const ok =
    Array.isArray(bbox) &&
    bbox.length === 4 &&
    bbox.every((v) => typeof v === 'number' && Number.isFinite(v)) &&
    bbox[0] <= bbox[2] &&
    bbox[1] <= bbox[3];
  if (!ok) {
    throw new ValidationError('A symbol annotation needs geometry.bbox = [x0, y0, x1, y1] with x0 <= x1 and y0 <= y1.');
  }
}
