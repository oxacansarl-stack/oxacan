import {
  Entity,
  PrimaryColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Task } from './task.entity';

@Entity('task_dependency')
export class TaskDependency {
  @PrimaryColumn({ type: 'uuid' })
  predecessorId: string;

  @ManyToOne(() => Task)
  @JoinColumn({ name: 'predecessor_id' })
  predecessor: Task;

  @PrimaryColumn({ type: 'uuid' })
  successorId: string;

  @ManyToOne(() => Task)
  @JoinColumn({ name: 'successor_id' })
  successor: Task;

  @Column({ type: 'text', default: 'finish_to_start' })
  type: string;

  @Column({ type: 'integer', default: 0 })
  lagDays: number;
}
