import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { Project } from '../projects/project.entity';
import { Visit } from './visit.entity';

@Injectable()
export class StatsService {
  constructor(
    @InjectRepository(Project)
    private projectsRepository: Repository<Project>,
    @InjectRepository(Visit)
    private visitRepository: Repository<Visit>,
  ) {}

  async getStats() {
    const totalProjects = await this.projectsRepository.count();
    
    const result = await this.projectsRepository
      .createQueryBuilder('project')
      .select('SUM(project.forks)', 'totalCommits')
      .getRawOne();
    
    const totalCommits = parseInt(result.totalCommits || '0');
    
    const contributorsResult = await this.projectsRepository
      .createQueryBuilder('project')
      .select('SUM(project.contributors)', 'totalContributors')
      .getRawOne();
    
    const totalContributors = parseInt(contributorsResult.totalContributors || '0');

    return {
      totalProjects,
      totalCommits,
      totalContributors,
    };
  }

  /**
   * Creates a unique identifier for a user based on IP address and User Agent
   */
  private createUserIdentifier(ipAddress: string, userAgent: string): string {
    const combined = `${ipAddress || 'unknown'}-${userAgent || 'unknown'}`;
    return createHash('sha256').update(combined).digest('hex');
  }

  async trackVisit(ipAddress: string, userAgent: string) {
    // Create unique identifier for this user
    const userIdentifier = this.createUserIdentifier(ipAddress, userAgent);
    
    // Check if this unique user already exists
    const existingVisit = await this.visitRepository.findOne({
      where: { userIdentifier },
    });
    
    // Only create a new record if this is a new unique user
    if (!existingVisit) {
      const newVisit = this.visitRepository.create({
        userIdentifier,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
      });
      await this.visitRepository.save(newVisit);
    }
    
    return { success: true };
  }

  async getUsersVisited() {
    // Count distinct unique users from the database
    const uniqueUsersCount = await this.visitRepository.count();
    
    // Return 189 as minimum/default value if count is 0
    return { count: uniqueUsersCount > 0 ? uniqueUsersCount : 189 };
  }
}

