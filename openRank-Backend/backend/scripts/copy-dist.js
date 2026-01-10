const fs = require('fs');
const path = require('path');

const distPath = path.join(__dirname, '../dist');
const apiDistPath = path.join(__dirname, '../api/dist');

// Create api/dist directory if it doesn't exist
if (!fs.existsSync(apiDistPath)) {
  fs.mkdirSync(apiDistPath, { recursive: true });
}

// Copy dist folder to api/dist
function copyRecursive(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();

  if (isDirectory) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }
    fs.readdirSync(src).forEach(childItemName => {
      copyRecursive(
        path.join(src, childItemName),
        path.join(dest, childItemName)
      );
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

if (fs.existsSync(distPath)) {
  copyRecursive(distPath, apiDistPath);
  console.log('Successfully copied dist to api/dist');
} else {
  console.error('dist folder not found!');
  process.exit(1);
}

