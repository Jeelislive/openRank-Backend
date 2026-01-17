import { Controller, Get, Query, Param, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import { DevelopersService } from './developers.service';
import { DevelopersSchedulerService } from './developers-scheduler.service';

@Controller('api/developers')
export class DevelopersController {
  constructor(
    private readonly developersService: DevelopersService,
    private readonly schedulerService: DevelopersSchedulerService,
  ) {}

  @Get('rankings')
  async getRankings(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('country') country?: string,
    @Query('city') city?: string,
    @Query('company') company?: string,
    @Query('profileType') profileType?: string,
    @Query('autoDiscover') autoDiscover?: string,
  ) {
    try {
      const pageNum = page ? parseInt(page) : 1;
      const limitNum = limit ? parseInt(limit) : 25;
      const offset = (pageNum - 1) * limitNum;
      const shouldAutoDiscover = autoDiscover !== 'false';

      const result = await this.developersService.getRankedDevelopersWithAutoDiscover(
        limitNum,
        offset,
        country,
        city,
        company,
        profileType,
        shouldAutoDiscover
      );

      return {
        developers: result.developers.map((dev, index) => ({
          ...dev,
          rank: offset + index + 1,
        })),
        total: result.total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(result.total / limitNum),
        autoDiscovered: result.autoDiscovered || false,
        maxScore: result.maxScore,
      };
    } catch (error) {
      throw new HttpException(
        `Failed to fetch rankings: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('check-rank/:username')
  async checkRank(
    @Param('username') username: string,
    @Query('country') country?: string,
    @Query('city') city?: string,
    @Query('company') company?: string,
    @Query('profileType') profileType?: string,
  ) {
    try {
      const developerExists = await this.developersService.getDeveloperByUsername(username);
      
      if (!developerExists) {
        const isEligible = await this.developersService.isDeveloperEligible(username);
        if (!isEligible) {
          return {
            username,
            eligible: false,
            processing: false,
            message: 'You are not eligible for ranking. To be eligible, you must meet at least ONE of these criteria (within last 90 days):\n• ≥ 10 merged PRs to a public repo\n• ≥ 2 issues closed (not self-created)\n• ≥ 1 PR review accepted\n• Maintainer of an active repo',
            rank: 0,
            total: 0,
            score: 0,
            developer: null,
            filters: {
              country: country || 'Global',
              city: city || 'All Cities',
              company: company || 'All Companies',
              profileType: profileType || 'All Types',
            },
          };
        }
        
        // Trigger processing in background
        this.developersService.fetchAndCalculateDeveloper(username, true).then((developer) => {
          if (developer) {
            console.log(`✓ Successfully processed developer: ${username}`);
          } else {
            console.log(`✗ Failed to process developer: ${username}`);
          }
        }).catch((error) => {
          console.error(`Error processing developer ${username}:`, error);
        });
        
        return {
          username,
          eligible: true,
          processing: true,
          message: 'Processing your profile... This may take a few moments.',
          rank: 0,
          total: 0,
          score: 0,
          developer: null,
          filters: {
            country: country || 'Global',
            city: city || 'All Cities',
            company: company || 'All Companies',
            profileType: profileType || 'All Types',
          },
        };
      }

      const result = await this.developersService.getDeveloperRank(
        username,
        country,
        city,
        company,
        profileType
      );

      if (!result.developer) {
        return {
          username,
          eligible: true,
          processing: false,
          message: 'Developer not found in rankings with the selected filters.',
          rank: 0,
          total: result.total,
          score: 0,
          developer: null,
          filters: {
            country: country || 'Global',
            city: city || 'All Cities',
            company: company || 'All Companies',
            profileType: profileType || 'All Types',
          },
        };
      }

      const maxScore = await this.developersService.getMaxScore();
      const normalizedScore = this.developersService.normalizeScore(
        Number(result.developer.finalImpactScore),
        maxScore
      );

      return {
        username,
        eligible: true,
        processing: false,
        rank: result.rank,
        total: result.total,
        score: normalizedScore,
        developer: {
          ...result.developer,
          finalImpactScore: normalizedScore,
        },
        filters: {
          country: country || 'Global',
          city: city || 'All Cities',
          company: company || 'All Companies',
          profileType: profileType || 'All Types',
        },
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        `Failed to check rank: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('companies')
  async getCompanies() {
    try {
      const companies = await this.developersService.getAvailableCompanies();
      return { companies };
    } catch (error) {
      throw new HttpException(
        `Failed to fetch companies: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('profile-types')
  async getProfileTypes() {
    try {
      const profileTypes = await this.developersService.getAvailableProfileTypes();
      return { profileTypes };
    } catch (error) {
      throw new HttpException(
        `Failed to fetch profile types: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('auto-discover')
  async autoDiscover(@Query('limit') limit?: string) {
    try {
      const limitNum = limit ? parseInt(limit) : 100;
      const result = await this.developersService.autoDiscoverDevelopers(limitNum);
      
      return {
        message: 'Auto-discovery completed',
        discovered: result.discovered,
        processed: result.processed,
      };
    } catch (error) {
      throw new HttpException(
        `Failed to auto-discover developers: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('search')
  async searchDevelopers(@Query('q') query?: string, @Query('limit') limit?: string) {
    if (!query) {
      throw new HttpException('Search query is required', HttpStatus.BAD_REQUEST);
    }

    try {
      const limitNum = limit ? parseInt(limit) : 20;
      const developers = await this.developersService.searchDevelopers(query, limitNum);
      return { developers, total: developers.length };
    } catch (error) {
      throw new HttpException(
        `Failed to search developers: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('countries')
  async getCountries() {
    try {
      const countries = await this.developersService.getAvailableCountries();
      return { countries };
    } catch (error) {
      throw new HttpException(
        `Failed to fetch countries: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('cities')
  async getCities(@Query('country') country?: string) {
    if (!country) {
      throw new HttpException('Country parameter is required', HttpStatus.BAD_REQUEST);
    }

    try {
      const cities = await this.developersService.getAvailableCities(country);
      return { cities };
    } catch (error) {
      throw new HttpException(
        `Failed to fetch cities: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get(':username')
  async getDeveloper(@Param('username') username: string) {
    try {
      const developer = await this.developersService.getDeveloperByUsername(username);
      
      if (!developer) {
        throw new HttpException(`Developer ${username} not found`, HttpStatus.NOT_FOUND);
      }

      return developer;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        `Failed to fetch developer: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post(':username/calculate')
  async calculateDeveloper(@Param('username') username: string) {
    try {
      const developer = await this.developersService.fetchAndCalculateDeveloper(username);
      
      if (!developer) {
        throw new HttpException(
          `Developer ${username} is not eligible. Must meet activity criteria: ≥10 merged PRs, ≥2 issues closed, ≥1 PR review, or maintainer of active repo (within last 90 days)`,
          HttpStatus.BAD_REQUEST
        );
      }
      
      return {
        message: 'Developer data calculated successfully',
        developer,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        `Failed to calculate developer: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Post('trigger-discovery')
  async triggerDiscovery() {
    try {
      // Manually trigger the discovery job
      await this.schedulerService.handleDailyDiscovery();
      return {
        message: 'Discovery job triggered successfully. Check server logs for details.',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new HttpException(
        `Failed to trigger discovery: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
