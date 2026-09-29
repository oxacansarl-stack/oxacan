import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Company } from './entities/company.entity';
import { NotFoundError } from '@oxacan/shared-types';

@Injectable()
export class CompanyService {
  constructor(
    @InjectRepository(Company)
    private readonly companyRepo: Repository<Company>,
  ) {}

  async findById(companyId: string): Promise<Company> {
    const company = await this.companyRepo.findOne({
      where: { id: companyId },
    });
    if (!company) throw new NotFoundError('Company', companyId);
    return company;
  }

  async update(
    companyId: string,
    data: Partial<Company>,
  ): Promise<Company> {
    await this.companyRepo.update(companyId, data);
    return this.findById(companyId);
  }
}
