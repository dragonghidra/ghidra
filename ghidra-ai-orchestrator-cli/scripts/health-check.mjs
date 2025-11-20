#!/usr/bin/env node

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Use Node.js built-in color support for better cross-platform compatibility
const hasColors = process.stdout.isTTY && process.stdout.hasColors?.();
const colors = {
  reset: hasColors ? '\x1b[0m' : '',
  red: hasColors ? '\x1b[31m' : '',
  green: hasColors ? '\x1b[32m' : '',
  yellow: hasColors ? '\x1b[33m' : '',
  blue: hasColors ? '\x1b[34m' : '',
  magenta: hasColors ? '\x1b[35m' : '',
  cyan: hasColors ? '\x1b[36m' : ''
};

function logSuccess(message) {
  console.log(`${colors.green}✅${colors.reset} ${message}`);
}

function logError(message) {
  console.log(`${colors.red}❌${colors.reset} ${message}`);
}

function logWarning(message) {
  console.log(`${colors.yellow}⚠️${colors.reset} ${message}`);
}

function logInfo(message) {
  console.log(`${colors.blue}ℹ️${colors.reset} ${message}`);
}

function checkFileExists(path, description = path) {
  if (existsSync(path)) {
    logSuccess(`${description} - Exists`);
    return true;
  } else {
    logError(`${description} - Missing`);
    return false;
  }
}

function checkJsonFile(path, description = path) {
  if (!checkFileExists(path, description)) return false;
  
  try {
    const content = JSON.parse(readFileSync(path, 'utf8'));
    logSuccess(`${description} - Valid JSON`);
    return content;
  } catch (error) {
    logError(`${description} - Invalid JSON: ${error.message}`);
    return null;
  }
}

console.log(`${colors.cyan}🧪 APT CLI Comprehensive Health Check${colors.reset}\n`);

let hasErrors = false;
let hasWarnings = false;

// Check Node version using proper semver comparison
console.log(`${colors.magenta}📦 Node.js Environment${colors.reset}`);
const nodeVersion = process.version;
const [major] = process.versions.node.split('.').map(Number);
console.log(`   Version: ${nodeVersion}`);

if (major >= 20) {
  logSuccess(`Node.js version meets requirement (>=20.0.0)`);
} else {
  logError(`Node.js 20.0.0 or newer is required`);
  hasErrors = true;
}

// Check package.json configuration
console.log(`\n${colors.magenta}📋 Package Configuration${colors.reset}`);
const packageJson = checkJsonFile('package.json', 'Package.json');

if (packageJson) {
  const requiredFields = ['name', 'version', 'description', 'main', 'bin'];
  const missingFields = requiredFields.filter(field => !packageJson[field]);

  if (missingFields.length === 0) {
    logSuccess('Package.json configuration valid');
  } else {
    logError(`Missing required fields: ${missingFields.join(', ')}`);
    hasErrors = true;
  }

  // Check apt-specific configuration
  if (packageJson.apt?.rulebookSchema) {
    logSuccess('APT rulebook schema configured');
  } else {
    logWarning('APT rulebook schema not configured in package.json');
    hasWarnings = true;
  }
}

// Check TypeScript compilation
console.log(`\n${colors.magenta}🔧 TypeScript & Build${colors.reset}`);
if (checkFileExists('dist', 'Build directory')) {
  // Check main binary
  if (checkFileExists('dist/bin/apt.js', 'Main binary')) {
    // Check bin file permissions
    const binCheck = spawnSync('ls', ['-la', 'dist/bin/apt.js'], { encoding: 'utf8' });
    if (binCheck.status === 0 && binCheck.stdout.includes('-rwx')) {
      logSuccess('Binary is executable');
    } else {
      logWarning('Binary is not executable');
      hasWarnings = true;
    }
  }
} else {
  logWarning('Build directory does not exist - run \'npm run build\'');
  hasWarnings = true;
}

// Check agent rulebooks
console.log(`\n${colors.magenta}📚 Agent Rulebooks${colors.reset}`);
const agentFiles = [
  { path: 'agents/apt-code.rules.json', name: 'APT Code rulebook' },
  { path: 'agents/general.rules.json', name: 'General rulebook' }
];

agentFiles.forEach(({ path, name }) => {
  const content = checkJsonFile(path, name);
  if (content) {
    const requiredFields = ['profile', 'version', 'label', 'globalPrinciples', 'phases'];
    const missingFields = requiredFields.filter(field => !content[field]);
    
    if (missingFields.length === 0) {
      logSuccess(`${name} - Valid structure`);
    } else {
      logError(`${name} - Missing required fields: ${missingFields.join(', ')}`);
      hasErrors = true;
    }
  }
});

// Check rulebook schema
console.log(`\n${colors.magenta}📄 Schema Validation${colors.reset}`);
checkFileExists('src/contracts/schemas/agent-rules.schema.json', 'Agent rules schema');

// Check core dependencies
console.log(`\n${colors.magenta}📦 Core Dependencies${colors.reset}`);
const coreFiles = [
  'src/core/agent.ts',
  'src/core/agentRulebook.ts', 
  'src/core/toolRuntime.ts',
  'src/providers/providerFactory.ts',
  'src/capabilities/index.ts'
];

coreFiles.forEach(file => checkFileExists(file, file));

// Summary
console.log(`\n${colors.cyan}📊 Health Check Summary${colors.reset}`);

if (hasErrors) {
  console.log(`${colors.red}❌ Health check failed with errors${colors.reset}`);
  console.log(`${colors.yellow}💡 Run 'npm run build' to rebuild the project${colors.reset}`);
  console.log(`${colors.yellow}💡 Run 'npm test' to verify functionality${colors.reset}`);
  process.exit(1);
} else if (hasWarnings) {
  console.log(`${colors.yellow}⚠️ Health check completed with warnings${colors.reset}`);
  console.log(`${colors.yellow}💡 Review warnings above and address as needed${colors.reset}`);
  process.exit(0);
} else {
  console.log(`${colors.green}🎉 Health check passed successfully!${colors.reset}`);
  console.log(`${colors.green}✅ The CLI is ready for use${colors.reset}`);
  console.log(`\n${colors.cyan}💡 Next steps:${colors.reset}`);
  console.log('   Run \'apt\' to start the CLI');
  console.log('   Run \'npm test\' for full test suite');
  console.log('   Run \'npm run build\' to rebuild if needed');
  process.exit(0);
}