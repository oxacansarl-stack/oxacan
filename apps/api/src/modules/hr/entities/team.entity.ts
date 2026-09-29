import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from 'typeorm';
import { AppUser } from '../../auth/entities/app-user.entity';
import { TeamMember } from './team-member.entity';

@Entity('team')
export class Team {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  companyId: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'uuid', nullable: true })
  leaderId: string | null;

  @ManyToOne(() => AppUser, { nullable: true })
  @JoinColumn({ name: 'leader_id' })
  leader: AppUser | null;

  @OneToMany(() => TeamMember, (member) => member.team)
  members: TeamMember[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
