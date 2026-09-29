import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { PurchaseOrder } from './entities/purchase-order.entity';
import { PurchaseOrderLine } from './entities/purchase-order-line.entity';
import { StockItem } from './entities/stock-item.entity';
import { StockMovement } from './entities/stock-movement.entity';
import { NotFoundError, BusinessRuleError } from '@oxacan/shared-types';
import {
  CreatePurchaseOrderDto,
  PurchaseOrderLineDto,
} from './dto/purchase-order.dto';

interface PurchaseOrderFilters {
  page?: number;
  limit?: number;
  supplierId?: string;
  projectId?: string;
  status?: string;
}

const DELIVERABLE_STATUSES = ['sent', 'confirmed', 'partially_delivered', 'delivered'];

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
    private readonly dataSource: DataSource,
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

    qb.orderBy('po.createdAt', 'DESC')
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

    const poId = await this.dataSource.transaction(async (m) => {
      // Serialise per company so the yearly PO-YYYY-NNNN sequence has no duplicates.
      await m.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`purchase_order:${companyId}`]);
      const prefix = `PO-${new Date().getFullYear()}-`;
      const [{ max }] = await m.query(
        `SELECT MAX(substring(reference from '[0-9]+$')::int) AS max
         FROM purchase_order WHERE company_id = $1 AND reference LIKE $2`,
        [companyId, `${prefix}%`],
      );
      const savedPo = await m.save(
        m.create(PurchaseOrder, {
          companyId,
          supplierId: dto.supplierId,
          projectId: dto.projectId || null,
          reference: `${prefix}${String((max ?? 0) + 1).padStart(4, '0')}`,
          status: 'draft',
          totalHtCents,
          createdById: userId,
        }),
      );
      for (const line of lineEntities) line.purchaseOrderId = savedPo.id;
      await m.save(lineEntities);
      return savedPo.id;
    });

    return this.findById(companyId, poId);
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
      delivered: [],
      cancelled: [],
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
    dto: PurchaseOrderLineDto,
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

  /**
   * deliveredQty is the line's cumulative delivered quantity; only the change since the last
   * recording is booked to stock, into a single stock item for the article.
   */
  async recordDelivery(
    companyId: string,
    orderId: string,
    lineId: string,
    deliveredQty: number,
    locationId?: string,
  ): Promise<PurchaseOrder> {
    await this.dataSource.transaction(async (m) => {
      const po = await m.findOne(PurchaseOrder, {
        where: { id: orderId, companyId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!po) throw new NotFoundError('PurchaseOrder', orderId);
      if (!DELIVERABLE_STATUSES.includes(po.status)) {
        throw new BusinessRuleError(
          'PO_NOT_DELIVERABLE',
          `Deliveries can only be recorded on sent or confirmed orders (status is '${po.status}').`,
        );
      }

      const line = await m.findOne(PurchaseOrderLine, {
        where: { id: lineId, purchaseOrderId: orderId, companyId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!line) throw new NotFoundError('PurchaseOrderLine', lineId);

      const delta = deliveredQty - Number(line.deliveredQuantity || 0);
      line.deliveredQuantity = deliveredQty;
      await m.save(line);

      if (delta !== 0 && line.canonicalArticleId) {
        const stockItem = await this.resolveDeliveryStockItem(m, companyId, line.canonicalArticleId, locationId);
        if (stockItem) {
          await m.save(
            m.create(StockMovement, {
              companyId,
              stockItemId: stockItem.id,
              type: delta > 0 ? 'in' : 'adjustment',
              quantity: delta,
              reference: `PO ${po.reference} line ${lineId}`,
            }),
          );
          stockItem.quantity = Number(stockItem.quantity || 0) + delta;
          await m.save(stockItem);
        }
      }

      const allLines = await m.find(PurchaseOrderLine, { where: { purchaseOrderId: orderId, companyId } });
      const allFullyDelivered = allLines.every((l) => Number(l.deliveredQuantity) >= Number(l.quantity));
      const anyDelivered = allLines.some((l) => Number(l.deliveredQuantity) > 0);
      po.status = allFullyDelivered ? 'delivered' : anyDelivered ? 'partially_delivered' : po.status;
      await m.save(po);
    });

    return this.findById(companyId, orderId);
  }

  /** The target location's item (created if needed), else the article's only stock item, else none. */
  private async resolveDeliveryStockItem(
    m: EntityManager,
    companyId: string,
    canonicalArticleId: string,
    locationId?: string,
  ): Promise<StockItem | null> {
    if (locationId) {
      const existing = await m.findOne(StockItem, {
        where: { companyId, canonicalArticleId, locationId },
        lock: { mode: 'pessimistic_write' },
      });
      return existing ?? m.save(m.create(StockItem, { companyId, canonicalArticleId, locationId, quantity: 0 }));
    }
    const items = await m.find(StockItem, {
      where: { companyId, canonicalArticleId },
      lock: { mode: 'pessimistic_write' },
    });
    if (items.length > 1) {
      throw new BusinessRuleError(
        'LOCATION_REQUIRED',
        'This article is stocked in several locations. Choose the location receiving the delivery.',
      );
    }
    return items[0] ?? null;
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
