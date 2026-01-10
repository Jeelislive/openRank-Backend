import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectsController } from './projects.controller';
import { CategoriesController } from './categories.controller';
import { LanguagesController } from './languages.controller';
import { ProjectsService } from './projects.service';
import { Project } from './project.entity';
import { GitHubService } from '../github/github.service';

@Module({
  imports: [TypeOrmModule.forFeature([Project])],
  controllers: [ProjectsController, CategoriesController, LanguagesController],
  providers: [ProjectsService, GitHubService],
})
export class ProjectsModule {}

