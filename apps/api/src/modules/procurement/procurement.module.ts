import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Supplier } from './entities/supplier.entity';
import { PurchaseOrder } from './entities/purchase-order.entity';
import { PurchaseOrderLine } from './entities/purchase-order-line.entity';
import { StockLocation } from './entities/stock-location.entity';
import { StockItem } from './entities/stock-item.entity';
import { StockMovement } from './entities/stock-movement.entity';
import { Vehicle } from './entities/vehicle.entity';
import { AppUser } from '../auth/entities/app-user.entity';
import { SupplierService } from './supplier.service';
import { PurchaseOrderService } from './purchase-order.service';
import { StockService } from './stock.service';
import { VehicleService } from './vehicle.service';
import { SupplierController } from './supplier.controller';
import { PurchaseOrderController } from './purchase-order.controller';
import { StockController } from './stock.controller';
import { VehicleController } from './vehicle.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Supplier,
      PurchaseOrder,
      PurchaseOrderLine,
      StockLocation,
      StockItem,
      StockMovement,
      Vehicle,
      AppUser,
    ]),
  ],
  providers: [SupplierService, PurchaseOrderService, StockService, VehicleService],
  controllers: [
    SupplierController,
    PurchaseOrderController,
    StockController,
    VehicleController,
  ],
  exports: [SupplierService, PurchaseOrderService, StockService, VehicleService],
})
export class ProcurementModule {}
