import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

@Entity('projects')
export class Project {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column('text')
  description: string;

  @Column()
  rank: number;

  @Column('simple-array', { nullable: true })
  tags: string[];

  @Column()
  stars: number;

  @Column()
  forks: number;

  @Column()
  status: string;

  @Column()
  language: string;

  @Column()
  category: string;

  @Column()
  lastUpdated: string;

  @Column()
  contributors: number;

  @Column({ nullable: true })
  githubUrl: string;

  @Column({ nullable: true })
  fullName: string;
}

