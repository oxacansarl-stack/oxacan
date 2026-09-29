import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('stock_location')
export class StockLocation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', nullable: true })
  type: string | null;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  @CreateDateColumn()
  createdAt: Date;
}
