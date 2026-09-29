import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PurchaseOrder } from './entities/purchase-order.entity';
import { PurchaseOrderLine } from './entities/purchase-order-line.entity';
import { StockItem } from './entities/stock-item.entity';
import { StockMovement } from './entities/stock-movement.entity';
import { NotFoundError, BusinessRuleError } from '@oxacan/shared-types';

interface PurchaseOrderFilters {
  page?: number;
  limit?: number;
  supplierId?: string;
  projectId?: string;
  status?: string;
}

interface CreateLineDto {
  description: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
  canonicalArticleId?: string;
}

interface CreatePurchaseOrderDto {
  supplierId: string;
  projectId?: string;
  lines: CreateLineDto[];
}

@Injectable()
export class PurchaseOrderService {
  constructor(
    @InjectRepository(PurchaseOrder)
    private readonly poRepo: Repository<PurchaseOrder>,
    @InjectRepository(PurchaseOrderLine)
    private readonly lineRepo: Repository<PurchaseOrderLine>,
    @InjectRepository(StockItem)
    private readonly stockItemRepo: Repository<StockItem>,
    @InjectRepository(StockMovement)
    private readonly stockMovementRepo: Repository<StockMovement>,
  ) {}

  /* ───────────── List ───────────── */

  async findAll(companyId: string, filters: PurchaseOrderFilters = {}) {
    const { page = 1, limit = 25, supplierId, projectId, status } = filters;

    const qb = this.poRepo
      .createQueryBuilder('po')
      .leftJoinAndSelect('po.supplier', 'supplier')
      .leftJoinAndSelect('po.project', 'project')
      .where('po.company_id = :companyId', { companyId });

    if (supplierId) {
      qb.andWhere('po.supplier_id = :supplierId', { supplierId });
    }
    if (projectId) {
      qb.andWhere('po.project_id = :projectId', { projectId });
    }
    if (status) {
      qb.andWhere('po.status = :status', { status });
    }

    qb.orderBy('po.created_at', 'DESC')
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

  async findById(companyId: string, id: string): Promise<PurchaseOrder> {
    const po = await this.poRepo.findOne({
      where: { id, companyId },
      relations: ['lines', 'supplier', 'project'],
    });
    if (!po) throw new NotFoundError('PurchaseOrder', id);
    return po;
  }

  /* ───────────── Create ───────────── */

  async create(
    companyId: string,
    userId: string,
    dto: CreatePurchaseOrderDto,
  ): Promise<PurchaseOrder> {
    if (!dto.lines || dto.lines.length === 0) {
      throw new BusinessRuleError(
        'NO_LINES',
        'A purchase order must have at least one line.',
      );
    }

    // Generate reference PO-YYYY-NNNN
    const year = new Date().getFullYear();
    const countResult = await this.poRepo
      .createQueryBuilder('po')
      .where('po.company_id = :companyId', { companyId })
      .andWhere('po.reference LIKE :prefix', { prefix: `PO-${year}-%` })
      .getCount();

    const seqNum = countResult + 1;
    const reference = `PO-${year}-${String(seqNum).padStart(4, '0')}`;

    // Compute line totals and overall total
    let totalHtCents = 0;
    const lineEntities: PurchaseOrderLine[] = [];

    for (const line of dto.lines) {
      const lineTotalCents = Math.round(line.quantity * line.unitPriceCents);
      totalHtCents += lineTotalCents;

      lineEntities.push(
        this.lineRepo.create({
          companyId,
          description: line.description,
          quantity: line.quantity,
          unit: line.unit,
          unitPriceCents: line.unitPriceCents,
          totalPriceCents: lineTotalCents,
          deliveredQuantity: 0,
          canonicalArticleId: line.canonicalArticleId || null,
        }),
      );
    }

    const po = this.poRepo.create({
      companyId,
      supplierId: dto.supplierId,
      projectId: dto.projectId || null,
      reference,
      status: 'draft',
      totalHtCents,
      createdById: userId,
    });

    const savedPo = await this.poRepo.save(po);

    // Set purchaseOrderId on lines and save
    for (const line of lineEntities) {
      line.purchaseOrderId = savedPo.id;
    }
    await this.lineRepo.save(lineEntities);

    return this.findById(companyId, savedPo.id);
  }

  /* ───────────── Update Status ───────────── */

  async updateStatus(
    companyId: string,
    id: string,
    status: string,
  ): Promise<PurchaseOrder> {
    const po = await this.findById(companyId, id);

    const validTransitions: Record<string, string[]> = {
      draft: ['sent', 'cancelled'],
      sent: ['confirmed', 'cancelled'],
      confirmed: ['partially_delivered', 'delivered', 'cancelled'],
      partially_delivered: ['delivered', 'cancelled'],
      delivered: ['closed'],
      cancelled: [],
      closed: [],
    };

    const allowed = validTransitions[po.status] || [];
    if (!allowed.includes(status)) {
      throw new BusinessRuleError(
        'INVALID_STATUS_TRANSITION',
        `Cannot transition from "${po.status}" to "${status}".`,
      );
    }

    po.status = status;

    if (status === 'sent' && !po.orderedAt) {
      po.orderedAt = new Date();
    }

    return this.poRepo.save(po);
  }

  /* ───────────── Add Line ───────────── */

  async addLine(
    companyId: string,
    orderId: string,
    dto: CreateLineDto,
  ): Promise<PurchaseOrder> {
    const po = await this.findById(companyId, orderId);

    const lineTotalCents = Math.round(dto.quantity * dto.unitPriceCents);

    const line = this.lineRepo.create({
      companyId,
      purchaseOrderId: orderId,
      description: dto.description,
      quantity: dto.quantity,
      unit: dto.unit,
      unitPriceCents: dto.unitPriceCents,
      totalPriceCents: lineTotalCents,
      deliveredQuantity: 0,
      canonicalArticleId: dto.canonicalArticleId || null,
    });

    await this.lineRepo.save(line);

    // Recalculate total
    await this.recalculateTotal(companyId, orderId);

    return this.findById(companyId, orderId);
  }

  /* ───────────── Remove Line ───────────── */

  async removeLine(
    companyId: string,
    orderId: string,
    lineId: string,
  ): Promise<PurchaseOrder> {
    await this.findById(companyId, orderId);

    const line = await this.lineRepo.findOne({
      where: { id: lineId, purchaseOrderId: orderId, companyId },
    });
    if (!line) throw new NotFoundError('PurchaseOrderLine', lineId);

    await this.lineRepo.remove(line);

    // Recalculate total
    await this.recalculateTotal(companyId, orderId);

    return this.findById(companyId, orderId);
  }

  /* ───────────── Record Delivery ───────────── */

  async recordDelivery(
    companyId: string,
    orderId: string,
    lineId: string,
    deliveredQty: number,
  ): Promise<PurchaseOrder> {
    const po = await this.findById(companyId, orderId);

    const line = await this.lineRepo.findOne({
      where: { id: lineId, purchaseOrderId: orderId, companyId },
    });
    if (!line) throw new NotFoundError('PurchaseOrderLine', lineId);

    line.deliveredQuantity = deliveredQty;
    await this.lineRepo.save(line);

    // Create stock movement if a matching stock item exists for this article
    if (line.canonicalArticleId) {
      const stockItems = await this.stockItemRepo.find({
        where: { companyId, canonicalArticleId: line.canonicalArticleId },
      });

      for (const stockItem of stockItems) {
        const movement = this.stockMovementRepo.create({
          companyId,
          stockItemId: stockItem.id,
          type: 'in',
          quantity: deliveredQty,
          reference: `PO ${po.reference} line ${lineId}`,
        });
        await this.stockMovementRepo.save(movement);

        // Update stock item quantity
        stockItem.quantity = (stockItem.quantity || 0) + deliveredQty;
        await this.stockItemRepo.save(stockItem);
      }
    }

    // Reload lines to check overall delivery status
    const allLines = await this.lineRepo.find({
      where: { purchaseOrderId: orderId, companyId },
    });

    const allFullyDelivered = allLines.every(
      (l) => l.deliveredQuantity >= l.quantity,
    );
    const anyDelivered = allLines.some((l) => l.deliveredQuantity > 0);

    if (allFullyDelivered) {
      po.status = 'delivered';
    } else if (anyDelivered) {
      po.status = 'partially_delivered';
    }

    await this.poRepo.save(po);

    return this.findById(companyId, orderId);
  }

  /* ───────────── Private Helpers ───────────── */

  private async recalculateTotal(
    companyId: string,
    orderId: string,
  ): Promise<void> {
    const result = await this.lineRepo
      .createQueryBuilder('line')
      .select('COALESCE(SUM(line.total_price_cents), 0)', 'total')
      .where('line.purchase_order_id = :orderId', { orderId })
      .andWhere('line.company_id = :companyId', { companyId })
      .getRawOne();

    const total = parseInt(result?.total || '0', 10);

    await this.poRepo.update(
      { id: orderId, companyId },
      { totalHtCents: total },
    );
  }
}
