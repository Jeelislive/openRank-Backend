import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

@Entity('developers')
@Index(['githubUsername'], { unique: true })
@Index(['finalImpactScore'])
@Index(['country', 'city'])
export class Developer {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 255, unique: true })
  githubUsername: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  name: string;

  @Column({ type: 'text', nullable: true })
  bio: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  avatarUrl: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  profileUrl: string;

  // Impact Score Factors
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  prImpact: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  issueImpact: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  dependencyInfluence: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  projectLongevity: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  communityImpact: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  docsImpact: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  consistency: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 1 })
  qualityMultiplier: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  finalImpactScore: number;

  // Profile Metrics
  @Column({ type: 'int', default: 0 })
  followers: number;

  @Column({ type: 'int', default: 0 })
  following: number;

  @Column({ type: 'int', default: 0 })
  publicRepos: number;

  @Column({ type: 'int', default: 0 })
  totalPRs: number;

  @Column({ type: 'int', default: 0 })
  totalCommits: number;

  @Column({ type: 'int', default: 0 })
  totalIssues: number;

  @Column({ type: 'int', default: 0 })
  totalLinesAdded: number;

  @Column({ type: 'int', default: 0 })
  totalLinesDeleted: number;

  @Column({ type: 'int', default: 0 })
  totalContributions: number;

  @Column({ type: 'int', default: 0 })
  totalStarsReceived: number;

  @Column({ type: 'int', default: 0 })
  totalForksReceived: number;

  // Geolocation
  @Column({ type: 'varchar', length: 100, nullable: true })
  @Index()
  country: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  @Index()
  city: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  location: string;

  // Company and Profile Type
  @Column({ type: 'varchar', length: 255, nullable: true })
  @Index()
  company: string;

  @Column({ type: 'varchar', length: 50, nullable: true, default: 'General' })
  @Index()
  profileType: string; // 'General', 'Specialized', etc.

  // Additional Metrics
  @Column({ type: 'simple-array', nullable: true })
  topLanguages: string[];

  @Column({ type: 'simple-array', nullable: true })
  topRepositories: string[];

  @Column({ type: 'int', default: 0 })
  activeProjects: number;

  @Column({ type: 'int', default: 0 })
  yearsActive: number;

  @Column({ type: 'timestamp', nullable: true })
  githubCreatedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  lastActiveAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  lastCalculatedAt: Date;
}
