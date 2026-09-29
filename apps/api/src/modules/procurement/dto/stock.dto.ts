import {
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** DB CHECK constraint on stock_location.type. */
export const STOCK_LOCATION_TYPES = ['warehouse', 'vehicle', 'site'] as const;

/** DB CHECK constraint on stock_movement.type. */
export const STOCK_MOVEMENT_TYPES = ['in', 'out', 'transfer', 'adjustment'] as const;
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

const MAX_QTY = 1_000_000_000;

export class CreateStockLocationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsIn(STOCK_LOCATION_TYPES)
  type!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;
}

export class CreateStockItemDto {
  @IsUUID()
  canonicalArticleId!: string;

  @IsUUID()
  locationId!: string;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_QTY)
  quantity?: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_QTY)
  minThreshold?: number;
}

export class UpdateStockItemDto {
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_QTY)
  quantity?: number;

  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_QTY)
  minThreshold?: number;
}

/**
 * `quantity` is never negative: for in/out/transfer it is the amount moved,
 * for `adjustment` the service sets the item to this absolute count.
 */
export class CreateStockMovementDto {
  @IsUUID()
  stockItemId!: string;

  @IsIn(STOCK_MOVEMENT_TYPES)
  type!: StockMovementType;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_QTY)
  quantity!: number;

  @IsOptional()
  @IsUUID()
  fromLocationId?: string;

  @IsOptional()
  @IsUUID()
  toLocationId?: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;
}
