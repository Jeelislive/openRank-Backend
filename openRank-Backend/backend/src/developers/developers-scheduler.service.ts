import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DevelopersService } from './developers.service';

@Injectable()
export class DevelopersSchedulerService {
  private readonly logger = new Logger(DevelopersSchedulerService.name);
  private isRunning = false;

  constructor(private readonly developersService: DevelopersService) {
    // Log when scheduler is initialized
    this.logger.log('DevelopersSchedulerService initialized. Cron job will run daily at midnight (00:00).');
    this.logger.log('Next scheduled run: Every day at 00:00 (midnight)');
  }

  // Run daily at midnight (00:00)
  @Cron('0 0 * * *')
  async handleDailyDiscovery() {
    if (this.isRunning) {
      this.logger.warn('Previous discovery job still running, skipping this cycle');
      return;
    }

    this.isRunning = true;
    this.logger.log('Starting daily developer discovery job (midnight run)...');
    
    try {
      // Get all available companies and locations
      const companies = await this.developersService.getAvailableCompanies();
      const countries = await this.developersService.getAvailableCountries();
      
      this.logger.log(`Found ${companies.length} companies and ${countries.length} countries to process`);

      let totalProcessed = 0;
      let skippedCount = 0;

      // Process companies one at a time (max 20 companies per cron run to avoid rate limits)
      // Each company = 1 API call, with 2 second delay = ~40 seconds for 20 companies
      this.logger.log(`Processing companies (max 20 per run, one API call per company)`);
      try {
        const processed = await this.developersService.batchDiscoverDevelopersByCompanies(
          companies,
          20, // Maximum 20 companies per cron run (20 API calls)
          30  // 30 results per company
        );
        totalProcessed += processed;
        this.logger.log(`Batch company discovery: ${processed} developers processed`);
      } catch (error: any) {
        if (error.status === 429 || error.status === 403) {
          this.logger.warn(`Rate limit reached during batch company discovery`);
        } else {
          this.logger.error(`Error in batch company discovery:`, error.message);
        }
      }

      // Process locations (location filter ignores company)
      for (const country of countries) {
        if (country === 'All Locations' || !country || country.trim() === '') {
          continue;
        }

        try {
          // Check country-level count
          const countryCount = await this.developersService.countDevelopersByFilters(null, country, null);
          
          if (countryCount >= 100) {
            skippedCount++;
            this.logger.log(`Skipping country ${country}: already has ${countryCount} developers (>= 100)`);
            continue;
          }

          // Get cities for this country
          const cities = await this.developersService.getAvailableCities(country);
          
          if (cities.length > 0) {
            // Process each city
            for (const city of cities) {
              if (city === 'All Cities' || !city || city.trim() === '') {
                continue;
              }

              try {
                const cityCount = await this.developersService.countDevelopersByFilters(null, country, city);
                
                if (cityCount >= 100) {
                  skippedCount++;
                  this.logger.log(`Skipping ${city}, ${country}: already has ${cityCount} developers (>= 100)`);
                  continue;
                }

                this.logger.log(`Fetching developers for location: ${city}, ${country} (current: ${cityCount}, target: 100)`);
                const processed = await this.developersService.fastAutoDiscoverBatch(20, country, city);
                totalProcessed += processed;
                this.logger.log(`Location ${city}, ${country}: ${processed} developers processed`);
                
                await new Promise(resolve => setTimeout(resolve, 2000));
              } catch (error: any) {
                if (error.status === 429 || error.status === 403) {
                  this.logger.warn(`Rate limit reached, stopping location discovery`);
                  break;
                }
                this.logger.error(`Error processing location ${city}, ${country}:`, error.message);
              }
            }
          } else {
            // No cities, process country-level
            this.logger.log(`Fetching developers for country: ${country} (current: ${countryCount}, target: 100)`);
            const processed = await this.developersService.fastAutoDiscoverBatch(20, country, null);
            totalProcessed += processed;
            this.logger.log(`Country ${country}: ${processed} developers processed`);
            
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        } catch (error: any) {
          if (error.status === 429 || error.status === 403) {
            this.logger.warn(`Rate limit reached, stopping location discovery`);
            break;
          }
          this.logger.error(`Error processing country ${country}:`, error.message);
        }
      }

      this.logger.log(`Daily discovery job completed: ${totalProcessed} developers processed, ${skippedCount} filters skipped (already have 100+ devs)`);
    } catch (error) {
      this.logger.error('Error in daily discovery job:', error);
    } finally {
      this.isRunning = false;
    }
  }
}
