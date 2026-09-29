import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Not, Repository } from 'typeorm';
import { Contract } from './entities/contract.entity';
import { ContractAmendment } from './entities/contract-amendment.entity';
import { Offer } from '../offers/entities/offer.entity';
import { Company } from '../company/entities/company.entity';
import { NotFoundError, BusinessRuleError } from '@oxacan/shared-types';
import { ProjectsService } from '../projects/projects.service';
import type { UpdateContractDto } from './dto/contract.dto';
import type { AddContractAmendmentDto as AddAmendmentDto } from './dto/contract-amendment.dto';

interface ContractFilters {
  page?: number;
  limit?: number;
  status?: string;
  clientId?: string;
  offerId?: string;
}

const CONTRACT_TRANSITIONS: Record<string, string[]> = {
  draft: ['sent', 'signed', 'terminated'],
  sent: ['draft', 'signed', 'terminated'],
  signed: ['active', 'terminated'],
  active: ['completed', 'terminated'],
  completed: [],
  terminated: [],
};

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
    private readonly dataSource: DataSource,
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

    qb.orderBy('contract.createdAt', 'DESC')
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

  async findById(companyId: string, id: string): Promise<Contract & { projectId: string | null }> {
    const contract = await this.contractRepo.findOne({
      where: { id, companyId },
      relations: ['amendments', 'offer', 'client'],
    });
    if (!contract) throw new NotFoundError('Contract', id);
    const [project] = await this.dataSource.query(
      'SELECT id FROM project WHERE contract_id = $1 AND company_id = $2',
      [id, companyId],
    );
    return Object.assign(contract, { projectId: project?.id ?? null });
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

    const company = await this.companyRepo.findOne({ where: { id: companyId } });
    const retentionRate = company?.defaultRetentionRate ?? 500;

    // Serialise per company so the one-contract-per-offer check and the yearly sequence can't race.
    return this.dataSource.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`contract:${companyId}`]);

      const existing = await m.findOne(Contract, {
        where: { companyId, offerId: offer.id, status: Not('terminated') },
      });
      if (existing) {
        throw new BusinessRuleError(
          'CONTRACT_EXISTS',
          `Offer already has contract ${existing.reference}.`,
        );
      }

      const prefix = `CTR-${new Date().getFullYear()}-`;
      const [{ max }] = await m.query(
        `SELECT MAX(substring(reference from '[0-9]+$')::int) AS max
         FROM contract WHERE company_id = $1 AND reference LIKE $2`,
        [companyId, `${prefix}%`],
      );
      const reference = `${prefix}${String((max ?? 0) + 1).padStart(4, '0')}`;

      return m.save(
        m.create(Contract, {
          companyId,
          offerId: offer.id,
          clientId: offer.clientId,
          reference,
          status: 'draft',
          totalTtcCents: offer.totalTtcCents,
          retentionRate,
          createdBy: userId,
        }),
      );
    });
  }

  async updateStatus(
    companyId: string,
    id: string,
    userId: string,
    newStatus: string,
  ): Promise<Contract> {
    const contract = await this.findById(companyId, id);
    const allowed = CONTRACT_TRANSITIONS[contract.status] ?? [];
    if (!allowed.includes(newStatus)) {
      throw new BusinessRuleError(
        'INVALID_STATUS_TRANSITION',
        `Cannot move a contract from '${contract.status}' to '${newStatus}'.`,
      );
    }

    // Conditional update so concurrent requests can't both win the same transition.
    const result = await this.contractRepo
      .createQueryBuilder()
      .update(Contract)
      .set(newStatus === 'signed' ? { status: newStatus, signedAt: () => 'NOW()' } : { status: newStatus })
      .where('id = :id AND company_id = :companyId AND status = :from', { id, companyId, from: contract.status })
      .execute();
    if (!result.affected) {
      throw new BusinessRuleError('STATUS_CHANGED', 'The contract status was changed by someone else. Reload and retry.');
    }

    if (newStatus === 'signed') {
      try {
        await this.projectsService.createFromContract(companyId, id, userId);
      } catch (err) {
        await this.contractRepo.update({ id, companyId }, { status: contract.status, signedAt: contract.signedAt });
        throw err;
      }
    }

    return this.findById(companyId, id);
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
