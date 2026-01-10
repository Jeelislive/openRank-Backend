import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
    TypeOrmModule.forRoot({
      type: 'postgres',
      ...(process.env.DATABASE_URL
        ? {
            // Use connection string if provided (Supabase)
            url: process.env.DATABASE_URL,
            // Supabase requires SSL for all connections
            ssl: { rejectUnauthorized: false },
          }
        : {
            // Fallback to individual parameters if connection string not provided
            host: process.env.DB_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT || '5432'),
            username: process.env.DB_USERNAME || 'postgres',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'openrank',
            ssl: false,
          }),
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      synchronize: process.env.NODE_ENV !== 'production', // Only in development
      autoLoadEntities: true,
    }),
    ProjectsModule,
    StatsModule,
  ],
})
export class AppModule {}

