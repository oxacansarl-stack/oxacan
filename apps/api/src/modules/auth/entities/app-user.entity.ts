import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import { Company } from '../../company/entities/company.entity';

@Entity('app_user')
@Unique(['companyId', 'email'])
export class AppUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @ManyToOne(() => Company)
  @JoinColumn({ name: 'company_id' })
  company: Company;

  @Column({ type: 'uuid', unique: true, nullable: true })
  supabaseAuthId: string | null;

  @Column({ type: 'text' })
  email: string;

  @Column({ type: 'text' })
  firstName: string;

  @Column({ type: 'text' })
  lastName: string;

  @Column({ type: 'text', nullable: true })
  phone: string | null;

  @Column({ type: 'text' })
  role: string;

  @Column({ type: 'text' })
  licenceTier: string;

  @Column({ type: 'integer', nullable: true })
  hourlyRateCents: number | null;

  @Column({ type: 'text', nullable: true })
  cctCode: string | null;

  @Column({ type: 'integer', default: 0 })
  overtimeBalanceMinutes: number;

  @Column({ type: 'date', nullable: true })
  hireDate: Date | null;

  @Column({ type: 'jsonb', default: '[]' })
  qualifications: Record<string, unknown>[];

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  deactivatedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
