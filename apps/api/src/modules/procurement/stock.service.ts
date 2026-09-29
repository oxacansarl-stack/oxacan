import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StockLocation } from './entities/stock-location.entity';
import { StockItem } from './entities/stock-item.entity';
import { StockMovement } from './entities/stock-movement.entity';
import { NotFoundError, BusinessRuleError } from '@oxacan/shared-types';

interface LocationFilters {
  page?: number;
  limit?: number;
}

interface ItemFilters {
  page?: number;
  limit?: number;
  locationId?: string;
  articleId?: string;
  belowThreshold?: boolean;
}

interface MovementFilters {
  page?: number;
  limit?: number;
  stockItemId?: string;
  type?: string;
  projectId?: string;
}

interface CreateMovementDto {
  stockItemId: string;
  type: 'in' | 'out' | 'transfer' | 'adjustment';
  quantity: number;
  fromLocationId?: string;
  toLocationId?: string;
  projectId?: string;
  reference?: string;
}

@Injectable()
export class StockService {
  constructor(
    @InjectRepository(StockLocation)
    private readonly locationRepo: Repository<StockLocation>,
    @InjectRepository(StockItem)
    private readonly itemRepo: Repository<StockItem>,
    @InjectRepository(StockMovement)
    private readonly movementRepo: Repository<StockMovement>,
  ) {}

  /* ───────────── Locations: List ───────────── */

  async findAllLocations(companyId: string, filters: LocationFilters = {}) {
    const { page = 1, limit = 25 } = filters;

    const qb = this.locationRepo
      .createQueryBuilder('loc')
      .where('loc.company_id = :companyId', { companyId });

    qb.orderBy('loc.name', 'ASC')
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

  /* ───────────── Locations: Create ───────────── */

  async createLocation(
    companyId: string,
    dto: { name: string; type: string; address?: string },
  ): Promise<StockLocation> {
    const location = this.locationRepo.create({
      companyId,
      name: dto.name,
      type: dto.type,
      address: dto.address || null,
    });

    return this.locationRepo.save(location);
  }

  /* ───────────── Items: List ───────────── */

  async findAllItems(companyId: string, filters: ItemFilters = {}) {
    const { page = 1, limit = 25, locationId, articleId, belowThreshold } = filters;

    const qb = this.itemRepo
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.location', 'location')
      .leftJoinAndSelect('item.canonicalArticle', 'article')
      .where('item.company_id = :companyId', { companyId });

    if (locationId) {
      qb.andWhere('item.location_id = :locationId', { locationId });
    }
    if (articleId) {
      qb.andWhere('item.canonical_article_id = :articleId', { articleId });
    }
    if (belowThreshold) {
      qb.andWhere('item.quantity < item.min_threshold');
    }

    qb.orderBy('item.id', 'ASC')
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

  /* ───────────── Items: Create ───────────── */

  async createItem(
    companyId: string,
    dto: {
      canonicalArticleId: string;
      locationId: string;
      quantity?: number;
      minThreshold?: number;
    },
  ): Promise<StockItem> {
    // Check for uniqueness (companyId, canonicalArticleId, locationId)
    const existing = await this.itemRepo.findOne({
      where: {
        companyId,
        canonicalArticleId: dto.canonicalArticleId,
        locationId: dto.locationId,
      },
    });

    if (existing) {
      throw new BusinessRuleError(
        'STOCK_ITEM_EXISTS',
        'A stock item for this article at this location already exists.',
      );
    }

    const item = this.itemRepo.create({
      companyId,
      canonicalArticleId: dto.canonicalArticleId,
      locationId: dto.locationId,
      quantity: dto.quantity ?? 0,
      minThreshold: dto.minThreshold ?? 0,
    });

    return this.itemRepo.save(item);
  }

  /* ───────────── Items: Update Quantity ───────────── */

  async updateItemQuantity(
    companyId: string,
    itemId: string,
    dto: { quantity?: number; minThreshold?: number },
  ): Promise<StockItem> {
    const item = await this.itemRepo.findOne({
      where: { id: itemId, companyId },
    });
    if (!item) throw new NotFoundError('StockItem', itemId);

    if (dto.quantity !== undefined) item.quantity = dto.quantity;
    if (dto.minThreshold !== undefined) item.minThreshold = dto.minThreshold;

    return this.itemRepo.save(item);
  }

  /* ───────────── Movements: List ───────────── */

  async findAllMovements(companyId: string, filters: MovementFilters = {}) {
    const { page = 1, limit = 25, stockItemId, type, projectId } = filters;

    const qb = this.movementRepo
      .createQueryBuilder('mov')
      .leftJoinAndSelect('mov.stockItem', 'stockItem')
      .where('mov.company_id = :companyId', { companyId });

    if (stockItemId) {
      qb.andWhere('mov.stock_item_id = :stockItemId', { stockItemId });
    }
    if (type) {
      qb.andWhere('mov.type = :type', { type });
    }
    if (projectId) {
      qb.andWhere('mov.project_id = :projectId', { projectId });
    }

    qb.orderBy('mov.created_at', 'DESC')
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

  /* ───────────── Movements: Create ───────────── */

  async createMovement(
    companyId: string,
    userId: string,
    dto: CreateMovementDto,
  ): Promise<StockMovement | StockMovement[]> {
    const stockItem = await this.itemRepo.findOne({
      where: { id: dto.stockItemId, companyId },
    });
    if (!stockItem) throw new NotFoundError('StockItem', dto.stockItemId);

    if (dto.type === 'transfer') {
      // Transfer creates two movements: out from source, in at destination
      if (!dto.fromLocationId || !dto.toLocationId) {
        throw new BusinessRuleError(
          'TRANSFER_REQUIRES_LOCATIONS',
          'Transfer movements require both fromLocationId and toLocationId.',
        );
      }

      // Find or validate destination stock item
      let destItem = await this.itemRepo.findOne({
        where: {
          companyId,
          canonicalArticleId: stockItem.canonicalArticleId,
          locationId: dto.toLocationId,
        },
      });

      if (!destItem) {
        // Auto-create destination stock item
        destItem = this.itemRepo.create({
          companyId,
          canonicalArticleId: stockItem.canonicalArticleId,
          locationId: dto.toLocationId,
          quantity: 0,
          minThreshold: 0,
        });
        destItem = await this.itemRepo.save(destItem);
      }

      // Deduct from source
      if (stockItem.quantity < dto.quantity) {
        throw new BusinessRuleError(
          'INSUFFICIENT_STOCK',
          `Insufficient stock. Available: ${stockItem.quantity}, requested: ${dto.quantity}.`,
        );
      }

      stockItem.quantity -= dto.quantity;
      await this.itemRepo.save(stockItem);

      // Add to destination
      destItem.quantity += dto.quantity;
      await this.itemRepo.save(destItem);

      const outMovement = this.movementRepo.create({
        companyId,
        stockItemId: stockItem.id,
        type: 'out',
        quantity: dto.quantity,
        fromLocationId: dto.fromLocationId,
        toLocationId: dto.toLocationId,
        projectId: dto.projectId || null,
        reference: dto.reference || null,
        performedBy: userId,
      });

      const inMovement = this.movementRepo.create({
        companyId,
        stockItemId: destItem.id,
        type: 'in',
        quantity: dto.quantity,
        fromLocationId: dto.fromLocationId,
        toLocationId: dto.toLocationId,
        projectId: dto.projectId || null,
        reference: dto.reference || null,
        performedBy: userId,
      });

      return this.movementRepo.save([outMovement, inMovement]);
    }

    // Non-transfer movement
    const movement = this.movementRepo.create({
      companyId,
      stockItemId: dto.stockItemId,
      type: dto.type,
      quantity: dto.quantity,
      fromLocationId: dto.fromLocationId || null,
      toLocationId: dto.toLocationId || null,
      projectId: dto.projectId || null,
      reference: dto.reference || null,
      performedBy: userId,
    });

    // Update stock item quantity
    switch (dto.type) {
      case 'in':
        stockItem.quantity += dto.quantity;
        break;
      case 'out':
        if (stockItem.quantity < dto.quantity) {
          throw new BusinessRuleError(
            'INSUFFICIENT_STOCK',
            `Insufficient stock. Available: ${stockItem.quantity}, requested: ${dto.quantity}.`,
          );
        }
        stockItem.quantity -= dto.quantity;
        break;
      case 'adjustment':
        stockItem.quantity = dto.quantity;
        break;
    }

    await this.itemRepo.save(stockItem);

    return this.movementRepo.save(movement);
  }
}
