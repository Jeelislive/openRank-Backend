import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DevelopersService } from './developers.service';

@Injectable()
export class DevelopersSchedulerService {
  private readonly logger = new Logger(DevelopersSchedulerService.name);
  private isRunning = false;

  constructor(private readonly developersService: DevelopersService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleHourlyDiscovery() {
    if (this.isRunning) {
      this.logger.warn('Previous discovery job still running, skipping this cycle');
      return;
    }

    this.isRunning = true;
    this.logger.log('Starting hourly developer discovery job...');
    
    try {
      const topCompanies = [
        'Google', 'Microsoft', 'Amazon', 'Apple', 'Meta', 'Facebook', 'Netflix', 
        'Uber', 'Airbnb', 'Twitter', 'LinkedIn', 'Oracle', 'IBM', 'Intel', 
        'Adobe', 'Salesforce', 'OpenAI', 'Anthropic', 'Vercel', 'Supabase'
      ];

      this.logger.log(`Processing ${topCompanies.length} companies this hour`);

      for (const company of topCompanies) {
        try {
          const processed = await this.developersService.discoverDevelopersByCompany(company, 30, 10);
          this.logger.log(`Company ${company}: ${processed} developers processed`);
          
          // Wait between companies to avoid rate limits
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error: any) {
          if (error.status !== 429 && error.status !== 403) {
            this.logger.error(`Error processing company ${company}:`, error);
          } else {
            this.logger.warn(`Rate limit reached, stopping company discovery`);
            break;
          }
        }
      }

      // Also do general location-based discovery (if not rate limited)
      try {
        const generalProcessed = await this.developersService.fastAutoDiscoverBatch(20);
        this.logger.log(`General discovery: ${generalProcessed} developers processed`);
      } catch (error: any) {
        if (error.status !== 429 && error.status !== 403) {
          this.logger.error('Error in general discovery:', error);
        }
      }

      this.logger.log('Hourly developer discovery job completed');
    } catch (error) {
      this.logger.error('Error in hourly discovery job:', error);
    } finally {
      this.isRunning = false;
    }
  }
}
