import { Controller, Get, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { StatsService } from './stats.service';

@Controller('api/stats')
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get()
  async getStats() {
    return this.statsService.getStats();
  }

  @Post('visit')
  async trackVisit(@Req() request: Request) {
    // Extract IP address from request
    const ipAddress = 
      (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
      (request.headers['x-real-ip'] as string) ||
      request.ip ||
      request.socket.remoteAddress ||
      'unknown';
    
    // Extract User Agent from request
    const userAgent = request.headers['user-agent'] || 'unknown';
    
    return this.statsService.trackVisit(ipAddress, userAgent);
  }

  @Get('users-visited')
  async getUsersVisited() {
    return this.statsService.getUsersVisited();
  }
}

