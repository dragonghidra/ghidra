#!/usr/bin/env node

/**
 * Development utilities for apt-cli
 * Provides common development tasks like cleaning, building, testing, and linting
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';

const commands = {
  clean: 'npm run clean',
  build: 'npm run build',
  'build:watch': 'npm run build:watch',
  test: 'npm test',
  'test:watch': 'npm run test:watch',
  'type-check': 'npm run type-check',
  'health-check': 'npm run health-check',
  dev: 'npm run dev',
  'dev:watch': 'npm run dev:watch',
};

function runCommand(name, command) {
  console.log(`\n🚀 Running: ${name}\n`);
  try {
    execSync(command, { stdio: 'inherit' });
    console.log(`\n✅ ${name} completed successfully\n`);
  } catch (error) {
    console.error(`\n❌ ${name} failed\n`);
    process.exit(1);
  }
}

function showHelp() {
  const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));
  
  console.log(`
📦 ${packageJson.name} v${packageJson.version} - Development Utilities

Available commands:
`);
  
  Object.entries(commands).forEach(([name, command]) => {
    console.log(`  ${name.padEnd(15)} ${command}`);
  });
  
  console.log(`
Usage:
  node scripts/dev-utils.mjs <command>
  node scripts/dev-utils.mjs all (runs clean, build, test, type-check)
  `);
}

function runAll() {
  console.log('\n🔧 Running full development workflow...\n');
  
  runCommand('clean', commands.clean);
  runCommand('build', commands.build);
  runCommand('test', commands.test);
  runCommand('type-check', commands['type-check']);
  
  console.log('\n🎉 All checks passed! Ready for development.\n');
}

const [,, command] = process.argv;

if (!command || command === 'help') {
  showHelp();
} else if (command === 'all') {
  runAll();
} else if (commands[command]) {
  runCommand(command, commands[command]);
} else {
  console.error(`\n❌ Unknown command: ${command}\n`);
  showHelp();
  process.exit(1);
}