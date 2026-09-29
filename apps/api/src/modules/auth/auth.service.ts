import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppUser } from './entities/app-user.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(AppUser)
    private readonly userRepo: Repository<AppUser>,
  ) {}

  async findBySupabaseId(supabaseAuthId: string): Promise<AppUser | null> {
    return this.userRepo.findOne({
      where: { supabaseAuthId, isActive: true },
    });
  }

  async findById(id: string): Promise<AppUser | null> {
    return this.userRepo.findOne({ where: { id } });
  }

  async findByCompanyId(companyId: string): Promise<AppUser[]> {
    return this.userRepo.find({ where: { companyId, isActive: true } });
  }
}
