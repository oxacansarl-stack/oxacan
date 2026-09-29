import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Contract } from './entities/contract.entity';
import { ContractAmendment } from './entities/contract-amendment.entity';
import { Offer } from '../offers/entities/offer.entity';
import { Company } from '../company/entities/company.entity';
import { NotFoundError, BusinessRuleError } from '@oxacan/shared-types';
import { ProjectsService } from '../projects/projects.service';

interface ContractFilters {
  page?: number;
  limit?: number;
  status?: string;
  clientId?: string;
  offerId?: string;
}

interface UpdateContractDto {
  notes?: string;
  retentionRate?: number;
}

interface AddAmendmentDto {
  description: string;
  amountDeltaCents?: number;
  status?: string;
}

@Injectable()
export class ContractsService {
  constructor(
    @InjectRepository(Contract)
    private readonly contractRepo: Repository<Contract>,
    @InjectRepository(ContractAmendment)
    private readonly amendmentRepo: Repository<ContractAmendment>,
    @InjectRepository(Offer)
    private readonly offerRepo: Repository<Offer>,
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
    @Inject(forwardRef(() => ProjectsService))
    private readonly projectsService: ProjectsService,
  ) {}

  /* ───────────── Contract CRUD ───────────── */

  async findAll(companyId: string, filters: ContractFilters = {}) {
    const { page = 1, limit = 25, status, clientId, offerId } = filters;

    const qb = this.contractRepo
      .createQueryBuilder('contract')
      .leftJoinAndSelect('contract.offer', 'offer')
      .leftJoinAndSelect('contract.client', 'client')
      .where('contract.company_id = :companyId', { companyId });

    if (status) {
      qb.andWhere('contract.status = :status', { status });
    }

    if (clientId) {
      qb.andWhere('contract.client_id = :clientId', { clientId });
    }

    if (offerId) {
      qb.andWhere('contract.offer_id = :offerId', { offerId });
    }

    qb.orderBy('contract.created_at', 'DESC')
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

  async findById(companyId: string, id: string): Promise<Contract> {
    const contract = await this.contractRepo.findOne({
      where: { id, companyId },
      relations: ['amendments', 'offer', 'client'],
    });
    if (!contract) throw new NotFoundError('Contract', id);
    return contract;
  }

  async createFromOffer(
    companyId: string,
    offerId: string,
    userId: string,
  ): Promise<Contract> {
    // 1. Load offer with client
    const offer = await this.offerRepo.findOne({
      where: { id: offerId, companyId },
      relations: ['client'],
    });
    if (!offer) throw new NotFoundError('Offer', offerId);

    // 2. Validate offer status is 'accepted'
    if (offer.status !== 'accepted') {
      throw new BusinessRuleError(
        'OFFER_NOT_ACCEPTED',
        `Cannot create contract: offer status is '${offer.status}', must be 'accepted'.`,
      );
    }

    // 3. Generate reference: CTR-{YEAR}-{sequence}
    const year = new Date().getFullYear();
    const existingCount = await this.contractRepo.count({
      where: { companyId },
    });
    const sequence = String(existingCount + 1).padStart(4, '0');
    const reference = `CTR-${year}-${sequence}`;

    // 4. Get company defaults for retention rate
    const company = await this.companyRepo.findOne({
      where: { id: companyId },
    });
    const retentionRate = company?.defaultRetentionRate ?? 500;

    // 5. Create contract
    const contract = this.contractRepo.create({
      companyId,
      offerId: offer.id,
      clientId: offer.clientId,
      reference,
      status: 'draft',
      totalTtcCents: offer.totalTtcCents,
      retentionRate,
      createdBy: userId,
    });

    return this.contractRepo.save(contract);
  }

  async updateStatus(
    companyId: string,
    id: string,
    userId: string,
    newStatus: string,
  ): Promise<Contract> {
    const contract = await this.findById(companyId, id);

    contract.status = newStatus;

    if (newStatus === 'signed') {
      contract.signedAt = new Date();
    }

    const saved = await this.contractRepo.save(contract);

    // If signed, trigger project creation
    if (newStatus === 'signed') {
      await this.projectsService.createFromContract(companyId, saved.id, userId);
    }

    return this.findById(companyId, saved.id);
  }

  async addAmendment(
    companyId: string,
    contractId: string,
    dto: AddAmendmentDto,
  ): Promise<ContractAmendment> {
    // Ensure contract exists
    await this.findById(companyId, contractId);

    // Auto-increment amendmentNumber
    const maxNum = await this.amendmentRepo
      .createQueryBuilder('amendment')
      .select('COALESCE(MAX(amendment.amendment_number), 0)', 'maxNum')
      .where('amendment.contract_id = :contractId', { contractId })
      .andWhere('amendment.company_id = :companyId', { companyId })
      .getRawOne();

    const amendmentNumber = (maxNum?.maxNum ?? 0) + 1;

    const amendment = this.amendmentRepo.create({
      contractId,
      companyId,
      amendmentNumber,
      description: dto.description,
      amountDeltaCents: dto.amountDeltaCents ?? 0,
      status: dto.status ?? 'draft',
    });

    return this.amendmentRepo.save(amendment);
  }

  async update(
    companyId: string,
    id: string,
    dto: UpdateContractDto,
  ): Promise<Contract> {
    const contract = await this.findById(companyId, id);
    Object.assign(contract, dto);
    return this.contractRepo.save(contract);
  }
}
