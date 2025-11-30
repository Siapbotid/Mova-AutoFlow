// Simple test script to verify the application setup
const { app, BrowserWindow } = require('electron');
const path = require('path');

console.log('Testing AutoFlow application setup...');

// Test 1: Check if all required files exist
const fs = require('fs');
const requiredFiles = [
  'src/main.js',
  'src/preload.js',
  'src/renderer/index.html',
  'src/renderer/styles.css',
  'src/renderer/app.js',
  'src/renderer/api.js'
];

console.log('\n1. Checking required files:');
requiredFiles.forEach(file => {
  const exists = fs.existsSync(path.join(__dirname, file));
  console.log(`   ${file}: ${exists ? '✅' : '❌'}`);
});

// Test 2: Check if package.json has correct dependencies
console.log('\n2. Checking package.json dependencies:');
const packageJson = require('./package.json');
const requiredDeps = ['axios', 'form-data', 'fs-extra'];
const requiredDevDeps = ['electron', 'electron-builder'];

requiredDeps.forEach(dep => {
  const exists = packageJson.dependencies && packageJson.dependencies[dep];
  console.log(`   ${dep}: ${exists ? '✅' : '❌'}`);
});

requiredDevDeps.forEach(dep => {
  const exists = packageJson.devDependencies && packageJson.devDependencies[dep];
  console.log(`   ${dep}: ${exists ? '✅' : '❌'}`);
});

// Test 3: Check if assets exist
console.log('\n3. Checking assets:');
const assetFiles = ['icon.ico', 'icon.png', 'overview.svg', 'setting.svg', 'logs.svg', 'about.svg'];
assetFiles.forEach(asset => {
  const exists = fs.existsSync(path.join(__dirname, 'assets', asset));
  console.log(`   assets/${asset}: ${exists ? '✅' : '❌'}`);
});

console.log('\n✅ Test completed! Run "npm start" to launch the application.');