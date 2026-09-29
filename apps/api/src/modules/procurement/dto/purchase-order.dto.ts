import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsCents } from '../../../common/validation/decorators';

/** DB CHECK constraint on purchase_order.status. */
export const PO_STATUSES = [
  'draft',
  'sent',
  'confirmed',
  'partially_delivered',
  'delivered',
  'cancelled',
] as const;

const MAX_QTY = 1_000_000_000;

export class PurchaseOrderLineDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  description!: string;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_QTY)
  quantity!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  unit!: string;

  @IsCents()
  unitPriceCents!: number;

  @IsOptional()
  @IsUUID()
  canonicalArticleId?: string;
}

export class CreatePurchaseOrderDto {
  @IsUUID()
  supplierId!: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderLineDto)
  lines!: PurchaseOrderLineDto[];
}

export class UpdatePurchaseOrderStatusDto {
  @IsIn(PO_STATUSES)
  status!: string;
}

export class RecordDeliveryDto {
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(MAX_QTY)
  deliveredQuantity!: number;

  @IsOptional()
  @IsUUID()
  locationId?: string;
}
