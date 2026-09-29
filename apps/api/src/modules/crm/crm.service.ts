import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { Client } from './entities/client.entity';
import { ClientContact } from './entities/client-contact.entity';
import { ClientInteraction } from './entities/client-interaction.entity';
import { NotFoundError } from '@oxacan/shared-types';

interface ClientFilters {
  page?: number;
  limit?: number;
  pipelineStage?: string;
  type?: string;
  search?: string;
}

@Injectable()
export class CrmService {
  constructor(
    @InjectRepository(Client)
    private readonly clientRepo: Repository<Client>,
    @InjectRepository(ClientContact)
    private readonly contactRepo: Repository<ClientContact>,
    @InjectRepository(ClientInteraction)
    private readonly interactionRepo: Repository<ClientInteraction>,
  ) {}

  async findAllClients(companyId: string, filters: ClientFilters = {}) {
    const { page = 1, limit = 25, pipelineStage, type, search } = filters;

    const qb = this.clientRepo
      .createQueryBuilder('client')
      .where('client.company_id = :companyId', { companyId });

    if (pipelineStage) {
      qb.andWhere('client.pipeline_stage = :pipelineStage', { pipelineStage });
    }

    if (type) {
      qb.andWhere('client.type = :type', { type });
    }

    if (search) {
      qb.andWhere(
        '(client.name ILIKE :search OR client.contact_person ILIKE :search OR client.email ILIKE :search)',
        { search: `%${search}%` },
      );
    }

    qb.orderBy('client.created_at', 'DESC')
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

  async findClientById(companyId: string, id: string): Promise<Client> {
    const client = await this.clientRepo.findOne({
      where: { id, companyId },
      relations: ['contacts', 'interactions', 'interactions.user'],
    });
    if (!client) throw new NotFoundError('Client', id);
    return client;
  }

  async createClient(
    companyId: string,
    data: Partial<Client>,
  ): Promise<Client> {
    const client = this.clientRepo.create({
      ...data,
      companyId,
    });
    return this.clientRepo.save(client);
  }

  async updateClient(
    companyId: string,
    id: string,
    data: Partial<Client>,
  ): Promise<Client> {
    const client = await this.findClientById(companyId, id);
    Object.assign(client, data);
    return this.clientRepo.save(client);
  }

  async addContact(
    companyId: string,
    clientId: string,
    data: Partial<ClientContact>,
  ): Promise<ClientContact> {
    // Ensure client exists and belongs to company
    await this.findClientById(companyId, clientId);

    const contact = this.contactRepo.create({
      ...data,
      clientId,
      companyId,
    });
    return this.contactRepo.save(contact);
  }

  async addInteraction(
    companyId: string,
    clientId: string,
    userId: string,
    data: Partial<ClientInteraction>,
  ): Promise<ClientInteraction> {
    // Ensure client exists and belongs to company
    await this.findClientById(companyId, clientId);

    const interaction = this.interactionRepo.create({
      ...data,
      clientId,
      companyId,
      userId,
    });
    return this.interactionRepo.save(interaction);
  }

  async updatePipelineStage(
    companyId: string,
    id: string,
    stage: string,
  ): Promise<Client> {
    const client = await this.findClientById(companyId, id);
    client.pipelineStage = stage;
    return this.clientRepo.save(client);
  }
}
