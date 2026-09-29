import {
  Entity,
  PrimaryColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
} from 'typeorm';
import { Team } from './team.entity';
import { AppUser } from '../../auth/entities/app-user.entity';

@Entity('team_member')
export class TeamMember {
  @PrimaryColumn({ type: 'uuid' })
  teamId: string;

  @ManyToOne(() => Team)
  @JoinColumn({ name: 'team_id' })
  team: Team;

  @PrimaryColumn({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => AppUser)
  @JoinColumn({ name: 'user_id' })
  user: AppUser;

  @Column({ type: 'uuid' })
  companyId: string;

  @CreateDateColumn()
  joinedAt: Date;
}
