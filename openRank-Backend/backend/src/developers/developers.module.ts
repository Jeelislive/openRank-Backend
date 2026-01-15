import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { DevelopersController } from './developers.controller';
import { DevelopersService } from './developers.service';
import { DevelopersSchedulerService } from './developers-scheduler.service';
import { Developer } from './developer.entity';
import { GitHubModule } from '../github/github.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Developer]),
    GitHubModule,
    ScheduleModule.forRoot(),
  ],
  controllers: [DevelopersController],
  providers: [DevelopersService, DevelopersSchedulerService],
  exports: [DevelopersService],
})
export class DevelopersModule {}
