// Vercel serverless function entry point
// This file imports the handler from the compiled NestJS app
const path = require('path');
const fs = require('fs');

let handler;

try {
  // Try multiple possible paths for dist/main.js
  const possiblePaths = [
    path.join(__dirname, 'dist/main.js'),  // dist copied into api folder (Vercel)
    path.join(__dirname, '../dist/main.js'),  // dist at project root (local/dev)
    path.join(process.cwd(), 'dist/main.js'),
    path.join(process.cwd(), 'backend/dist/main.js'),
    '../dist/main.js'
  ];

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
    console.log('Request received:', req.method, req.url, req.path);
    try {
      await handler(req, res);
    } catch (error) {
      console.error('Handler wrapper error:', error);
      if (!res.headersSent) {
        res.status(500).json({ 
          error: 'Handler execution error',
          message: error.message 
        });
      }
    }
  };
} else {
  module.exports = async (req, res) => {
    console.error('Handler is not a function:', typeof handler);
    res.status(500).json({ 
      error: 'Invalid handler',
      message: 'Handler is not a function'
    });
  };
}

