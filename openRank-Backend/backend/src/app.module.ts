import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectsModule } from './projects/projects.module';
import { StatsModule } from './stats/stats.module';

@Module({
  imports: [
    // Load environment variables from .env file
    ConfigModule.forRoot({
      isGlobal: true, // Make ConfigModule available globally
      envFilePath: '.env', // Path to .env file
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const databaseUrl = configService.get<string>('DATABASE_URL') || 
                           configService.get<string>('POSTGRES_URL');
        
        // Log connection info (without password for security)
        if (databaseUrl) {
          const urlWithoutPassword = databaseUrl.replace(/:[^:@]+@/, ':****@');
          console.log('Database URL found:', urlWithoutPassword);
        } else {
          console.warn('No DATABASE_URL or POSTGRES_URL found in environment variables');
        }
        
        return {
          type: 'postgres',
          ...(databaseUrl
            ? {
                // Use connection string if provided (Supabase)
                url: databaseUrl,
                // Supabase requires SSL for all connections
                ssl: { rejectUnauthorized: false },
              }
            : {
                // Fallback to individual parameters if connection string not provided
                host: configService.get<string>('POSTGRES_HOST') || 
                      configService.get<string>('DB_HOST') || 
                      'localhost',
                port: parseInt(
                  configService.get<string>('POSTGRES_PORT') || 
                  configService.get<string>('DB_PORT') || 
                  '5432'
                ),
                username: configService.get<string>('POSTGRES_USER') || 
                         configService.get<string>('DB_USERNAME') || 
                         'postgres',
                password: configService.get<string>('POSTGRES_PASSWORD') || 
                         configService.get<string>('DB_PASSWORD') || 
                         '',
                database: configService.get<string>('POSTGRES_DATABASE') || 
                         configService.get<string>('DB_NAME') || 
                         'openrank',
                ssl: configService.get<string>('POSTGRES_HOST') 
                  ? { rejectUnauthorized: false } 
                  : false,
              }),
          entities: [__dirname + '/**/*.entity{.ts,.js}'],
          synchronize: configService.get<string>('NODE_ENV') !== 'production', // Only in development
          autoLoadEntities: true,
          // Reduce retries for serverless to avoid timeouts
          retryAttempts: 1, // Only retry once in serverless
          retryDelay: 1000, // 1 second delay
          // Connection timeout
          connectTimeoutMS: 5000, // 5 seconds timeout
        };
      },
      inject: [ConfigService],
    }),
    ProjectsModule,
    StatsModule,
  ],
})
export class AppModule {}

