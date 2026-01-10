import { Controller, Get, Query, Post, Body, Param } from '@nestjs/common';
import { ProjectsService } from './projects.service';

@Controller('api/projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  async getProjects(
    @Query('category') category?: string,
    @Query('language') language?: string,
    @Query('sortBy') sortBy?: string,
    @Query('minStars') minStars?: string,
    @Query('search') search?: string,
  ) {
    return this.projectsService.findAll({
      category,
      language,
      sortBy,
      minStars: minStars ? parseInt(minStars) : undefined,
      search,
    });
  }

  @Post('extract-keywords')
  async extractKeywords(@Body() body: { query: string }) {
    return this.projectsService.extractKeywordsFromQuery(body.query);
  }

  @Get('details/:owner/:repo')
  async getRepositoryDetails(@Param('owner') owner: string, @Param('repo') repo: string) {
    return this.projectsService.getRepositoryDetails(owner, repo);
  }

  @Get('newly-added')
  async getNewlyAdded(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.projectsService.getNewlyAdded(
      page ? parseInt(page) : 1,
      limit ? parseInt(limit) : 10,
    );
  }
}
