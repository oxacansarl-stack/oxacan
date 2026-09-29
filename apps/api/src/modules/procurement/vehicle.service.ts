import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vehicle } from './entities/vehicle.entity';
import { NotFoundError } from '@oxacan/shared-types';
import { CreateVehicleDto, UpdateVehicleDto } from './dto/vehicle.dto';

interface VehicleFilters {
  page?: number;
  limit?: number;
}

@Injectable()
export class VehicleService {
  constructor(
    @InjectRepository(Vehicle)
    private readonly vehicleRepo: Repository<Vehicle>,
  ) {}

  /* ───────────── List ───────────── */

  async findAll(companyId: string, filters: VehicleFilters = {}) {
    const { page = 1, limit = 25 } = filters;

    const qb = this.vehicleRepo
      .createQueryBuilder('vehicle')
      .leftJoinAndSelect('vehicle.assignedTeam', 'team')
      .leftJoinAndSelect('vehicle.assignedProject', 'project')
      .where('vehicle.company_id = :companyId', { companyId });

    qb.orderBy('vehicle.registration', 'ASC')
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

  async findById(companyId: string, id: string): Promise<Vehicle> {
    const vehicle = await this.vehicleRepo.findOne({
      where: { id, companyId },
    });
    if (!vehicle) throw new NotFoundError('Vehicle', id);
    return vehicle;
  }

  /* ───────────── Create ───────────── */

  async create(companyId: string, dto: CreateVehicleDto): Promise<Vehicle> {
    const vehicle = this.vehicleRepo.create({
      companyId,
      registration: dto.registration,
      make: dto.make || null,
      model: dto.model || null,
      assignedTeamId: dto.assignedTeamId || null,
      assignedProjectId: dto.assignedProjectId || null,
      insuranceExpiry: dto.insuranceExpiry ? (dto.insuranceExpiry as any) : null,
      nextServiceDate: dto.nextServiceDate ? (dto.nextServiceDate as any) : null,
      odometerKm: dto.odometerKm ?? 0,
    });

    return this.vehicleRepo.save(vehicle);
  }

  /* ───────────── Update ───────────── */

  async update(
    companyId: string,
    id: string,
    dto: UpdateVehicleDto,
  ): Promise<Vehicle> {
    const vehicle = await this.findById(companyId, id);

    if (dto.registration !== undefined) vehicle.registration = dto.registration;
    if (dto.make !== undefined) vehicle.make = dto.make || null;
    if (dto.model !== undefined) vehicle.model = dto.model || null;
    if (dto.assignedTeamId !== undefined) vehicle.assignedTeamId = dto.assignedTeamId || null;
    if (dto.assignedProjectId !== undefined) vehicle.assignedProjectId = dto.assignedProjectId || null;
    if (dto.insuranceExpiry !== undefined) vehicle.insuranceExpiry = dto.insuranceExpiry ? (dto.insuranceExpiry as any) : null;
    if (dto.nextServiceDate !== undefined) vehicle.nextServiceDate = dto.nextServiceDate ? (dto.nextServiceDate as any) : null;
    if (dto.odometerKm !== undefined) vehicle.odometerKm = dto.odometerKm;

    return this.vehicleRepo.save(vehicle);
  }

  /* ───────────── Delete ───────────── */

  async delete(companyId: string, id: string): Promise<void> {
    const vehicle = await this.findById(companyId, id);
    await this.vehicleRepo.remove(vehicle);
  }
}
