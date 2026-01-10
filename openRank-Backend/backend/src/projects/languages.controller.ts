import { Controller, Get } from '@nestjs/common';
import { ProjectsService } from './projects.service';

@Controller('api/languages')
export class LanguagesController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  async getLanguages() {
    return this.projectsService.getLanguages();
  }
}

