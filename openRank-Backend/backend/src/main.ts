import { NestFactory } from '@nestjs/core';
import { ExpressAdapter } from '@nestjs/platform-express';
import { AppModule } from './app.module';

let cachedApp: any;

async function createApp() {
  if (cachedApp) {
    return cachedApp;
  }

  const express = require('express');
  const expressApp = express();
  const app = await NestFactory.create(AppModule, new ExpressAdapter(expressApp));
  
  // Enable CORS for frontend
  app.enableCors({
    origin: (origin, callback) => {
      const allowedOrigins = [
        'https://open-rank.vercel.app',
        'http://localhost:3000',
        process.env.FRONTEND_URL,
      ].filter(Boolean);
      
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

  await app.init();
  cachedApp = expressApp;
  return expressApp;
}

// Vercel serverless handler
async function handler(req: any, res: any) {
  // Handle OPTIONS preflight requests IMMEDIATELY without app initialization
  if (req.method === 'OPTIONS') {
    const allowedOrigins = [
      'https://open-rank.vercel.app',
      'http://localhost:3000',
      process.env.FRONTEND_URL,
    ].filter(Boolean);
    
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    } else if (allowedOrigins.length > 0) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigins[0]);
    }
    
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400'); // 24 hours
    
    return res.status(204).end();
  }

  try {
    const app = await createApp();
    app(req, res);
  } catch (error) {
    console.error('Handler error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  }
}

export default handler;

// Regular server bootstrap (for local development)
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Enable CORS for frontend
  app.enableCors({
    origin: (origin, callback) => {
      const allowedOrigins = [
        'https://open-rank.vercel.app',
        'http://localhost:3000',
        process.env.FRONTEND_URL,
      ].filter(Boolean);
      
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

  const port = process.env.PORT || 3001;
  await app.listen(port);
  console.log(`Server running on Port : ${port}`);
}

// Only bootstrap if not running on Vercel
if (require.main === module) {
  bootstrap();
}

