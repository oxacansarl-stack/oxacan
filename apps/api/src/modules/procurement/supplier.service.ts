import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Supplier } from './entities/supplier.entity';
import { NotFoundError, BusinessRuleError } from '@oxacan/shared-types';

interface SupplierFilters {
  page?: number;
  limit?: number;
  search?: string;
}

interface CreateSupplierDto {
  name: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  address?: string;
  paymentTermsDays?: number;
  notes?: string;
}

@Injectable()
export class SupplierService {
  constructor(
    @InjectRepository(Supplier)
    private readonly supplierRepo: Repository<Supplier>,
  ) {}

  /* ───────────── List ───────────── */

  async findAll(companyId: string, filters: SupplierFilters = {}) {
    const { page = 1, limit = 25, search } = filters;

    const qb = this.supplierRepo
      .createQueryBuilder('supplier')
      .where('supplier.company_id = :companyId', { companyId });

    if (search) {
      qb.andWhere(
        '(LOWER(supplier.name) LIKE :search OR LOWER(supplier.contact_person) LIKE :search)',
        { search: `%${search.toLowerCase()}%` },
      );
    }

    qb.orderBy('supplier.name', 'ASC')
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

  async findById(companyId: string, id: string): Promise<Supplier> {
    const supplier = await this.supplierRepo.findOne({
      where: { id, companyId },
    });
    if (!supplier) throw new NotFoundError('Supplier', id);
    return supplier;
  }

  /* ───────────── Create ───────────── */

  async create(companyId: string, dto: CreateSupplierDto): Promise<Supplier> {
    const supplier = this.supplierRepo.create({
      companyId,
      name: dto.name,
      contactPerson: dto.contactPerson || null,
      email: dto.email || null,
      phone: dto.phone || null,
      address: dto.address || null,
      paymentTermsDays: dto.paymentTermsDays ?? 30,
      notes: dto.notes || null,
    });

    return this.supplierRepo.save(supplier);
  }

  /* ───────────── Update ───────────── */

  async update(
    companyId: string,
    id: string,
    dto: Partial<CreateSupplierDto>,
  ): Promise<Supplier> {
    const supplier = await this.findById(companyId, id);

    if (dto.name !== undefined) supplier.name = dto.name;
    if (dto.contactPerson !== undefined) supplier.contactPerson = dto.contactPerson || null;
    if (dto.email !== undefined) supplier.email = dto.email || null;
    if (dto.phone !== undefined) supplier.phone = dto.phone || null;
    if (dto.address !== undefined) supplier.address = dto.address || null;
    if (dto.paymentTermsDays !== undefined) supplier.paymentTermsDays = dto.paymentTermsDays;
    if (dto.notes !== undefined) supplier.notes = dto.notes || null;

    return this.supplierRepo.save(supplier);
  }

  /* ───────────── Delete ───────────── */

  async delete(companyId: string, id: string): Promise<void> {
    const supplier = await this.findById(companyId, id);

    // Check for referencing purchase orders via a raw query to avoid
    // importing PurchaseOrder entity in this service
    const poCount = await this.supplierRepo.manager
      .createQueryBuilder()
      .from('purchase_order', 'po')
      .where('po.supplier_id = :id', { id })
      .andWhere('po.company_id = :companyId', { companyId })
      .getCount();

    if (poCount > 0) {
      throw new BusinessRuleError(
        'SUPPLIER_HAS_ORDERS',
        `Cannot delete supplier "${supplier.name}" because it has ${poCount} purchase order(s).`,
      );
    }

    await this.supplierRepo.remove(supplier);
  }
}
