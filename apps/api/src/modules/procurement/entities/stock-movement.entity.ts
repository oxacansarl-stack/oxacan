import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { StockItem } from './stock-item.entity';
import { StockLocation } from './stock-location.entity';
import { Project } from '../../projects/entities/project.entity';
import { AppUser } from '../../auth/entities/app-user.entity';

@Entity('stock_movement')
export class StockMovement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'uuid' })
  stockItemId: string;

  @ManyToOne(() => StockItem)
  @JoinColumn({ name: 'stock_item_id' })
  stockItem: StockItem;

  @Column({ type: 'text' })
  type: string;

  @Column({ type: 'real' })
  quantity: number;

  @Column({ type: 'uuid', nullable: true })
  fromLocationId: string | null;

  @ManyToOne(() => StockLocation, { nullable: true })
  @JoinColumn({ name: 'from_location_id' })
  fromLocation: StockLocation | null;

  @Column({ type: 'uuid', nullable: true })
  toLocationId: string | null;

  @ManyToOne(() => StockLocation, { nullable: true })
  @JoinColumn({ name: 'to_location_id' })
  toLocation: StockLocation | null;

  @Column({ type: 'uuid', nullable: true })
  projectId: string | null;

  @ManyToOne(() => Project, { nullable: true })
  @JoinColumn({ name: 'project_id' })
  project: Project | null;

  @Column({ type: 'text', nullable: true })
  reference: string | null;

  @Column({ type: 'uuid', nullable: true })
  performedBy: string | null;

  @ManyToOne(() => AppUser, { nullable: true })
  @JoinColumn({ name: 'performed_by' })
  performer: AppUser | null;

  @CreateDateColumn()
  createdAt: Date;
}
