import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Plan } from './entities/plan.entity';
import { PlanAnnotation } from './entities/plan-annotation.entity';
import { NotFoundError } from '@oxacan/shared-types';
import { CreatePlanDto, UpdatePlanDto, CreateAnnotationDto } from './dto/plan.dto';

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
}
