// Vercel serverless function entry point
// This file imports the handler from the compiled NestJS app
let handler;

try {
  const mainModule = require('../dist/main.js');
  handler = mainModule.default || mainModule;
  
  if (!handler) {
    throw new Error('Handler not found in main.js');
  }
} catch (error) {
  console.error('Error loading handler:', error);
  handler = async (req, res) => {
    res.status(500).json({ 
      error: 'Failed to load serverless handler',
      message: error.message 
    });
  };
}

module.exports = handler;

