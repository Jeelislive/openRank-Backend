// Vercel serverless function entry point
// This file imports the handler from the compiled NestJS app
const path = require('path');
const fs = require('fs');

let handler;

try {
  // Try multiple possible paths for dist/main.js
  const possiblePaths = [
    path.join(__dirname, 'dist/main.js'),  // dist copied into api folder (Vercel)
    path.join(__dirname, '../dist/main.js'),  // dist at backend root (local/dev)
    path.join(process.cwd(), 'dist/main.js'),  // dist at process root
    path.join(process.cwd(), 'backend/dist/main.js'),  // dist at backend from root
    '../dist/main.js'  // relative fallback
  ];
  
  console.log('Searching for dist/main.js...');
  console.log('__dirname:', __dirname);
  console.log('process.cwd():', process.cwd());

  let mainModule = null;
  let usedPath = null;

  for (const distPath of possiblePaths) {
    try {
      const resolvedPath = path.resolve(__dirname, distPath);
      if (fs.existsSync(resolvedPath)) {
        console.log('Found dist/main.js at:', resolvedPath);
        mainModule = require(resolvedPath);
        usedPath = resolvedPath;
        break;
      }
    } catch (e) {
      // Try next path
      continue;
    }
  }

  if (!mainModule) {
    // Last attempt with relative path
    try {
      mainModule = require('../dist/main.js');
      usedPath = '../dist/main.js';
    } catch (e) {
      throw new Error(`Cannot find dist/main.js. Tried paths: ${possiblePaths.join(', ')}. Current dir: ${__dirname}, CWD: ${process.cwd()}`);
    }
  }

  handler = mainModule.default || mainModule;
  
  if (!handler) {
    throw new Error('Handler not found in main.js');
  }

  if (typeof handler !== 'function') {
    throw new Error(`Handler is not a function. Type: ${typeof handler}`);
  }

  console.log('Handler loaded successfully from:', usedPath);
  console.log('Handler type:', typeof handler);
} catch (error) {
  console.error('Error loading handler:', error);
  console.error('Current working directory:', process.cwd());
  console.error('__dirname:', __dirname);
  handler = async (req, res) => {
    res.status(500).json({ 
      error: 'Failed to load serverless handler',
      message: error.message 
    });
  };
}

// Wrapper to ensure proper async handling and logging
if (typeof handler === 'function') {
  module.exports = async (req, res) => {
    console.log('=== REQUEST START ===');
    console.log('Request received:', req.method, req.url, req.path);
    console.log('Handler type:', typeof handler);
    console.log('__dirname:', __dirname);
    console.log('process.cwd():', process.cwd());
    
    // Add a simple health check
    if (req.url === '/health' || req.path === '/health') {
      return res.status(200).json({ 
        status: 'ok',
        handler: typeof handler,
        dirname: __dirname,
        cwd: process.cwd()
      });
    }
    
    try {
      await handler(req, res);
    } catch (error) {
      console.error('Handler wrapper error:', error);
      console.error('Error stack:', error.stack);
      if (!res.headersSent) {
        res.status(500).json({ 
          error: 'Handler execution error',
          message: error.message,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
      }
    }
    console.log('=== REQUEST END ===');
  };
} else {
  module.exports = async (req, res) => {
    console.error('Handler is not a function:', typeof handler);
    res.status(500).json({ 
      error: 'Invalid handler',
      message: 'Handler is not a function',
      handlerType: typeof handler,
      dirname: __dirname,
      cwd: process.cwd()
    });
  };
}

