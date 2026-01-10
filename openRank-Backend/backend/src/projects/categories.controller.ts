import { Controller, Get } from '@nestjs/common';
import { ProjectsService } from './projects.service';

@Controller('api/categories')
export class CategoriesController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  async getCategories() {
    return this.projectsService.getCategories();
  }
}

