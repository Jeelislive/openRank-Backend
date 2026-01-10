import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectsController } from './projects.controller';
import { CategoriesController } from './categories.controller';
import { LanguagesController } from './languages.controller';
import { ProjectsService } from './projects.service';
import { Project } from './project.entity';
import { GitHubModule } from '../github/github.module';

@Module({
  imports: [TypeOrmModule.forFeature([Project]), GitHubModule],
  controllers: [ProjectsController, CategoriesController, LanguagesController],
  providers: [ProjectsService],
})
export class ProjectsModule {}

