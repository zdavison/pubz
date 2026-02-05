#!/usr/bin/env bun
/**
 * Mock npm script for testing.
 * Records all invocations to a JSON file, including package.json content at publish time.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

interface NpmCall {
  args: string[];
  cwd: string;
  timestamp: string;
  packageJson?: Record<string, unknown>;
}

const logFile = process.env.MOCK_NPM_LOG;
if (!logFile) {
  console.error('MOCK_NPM_LOG environment variable not set');
  process.exit(1);
}

const call: NpmCall = {
  args: process.argv.slice(2),
  cwd: process.cwd(),
  timestamp: new Date().toISOString(),
};

// Capture package.json content for publish commands
if (process.argv[2] === 'publish') {
  const packageJsonPath = join(process.cwd(), 'package.json');
  if (existsSync(packageJsonPath)) {
    call.packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  }
}

// Ensure directory exists
const dir = dirname(logFile);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

// Append call to log file (one JSON object per line)
appendFileSync(logFile, JSON.stringify(call) + '\n');

// Simulate npm publish output
if (process.argv[2] === 'publish') {
  console.log(`npm notice`);
  console.log(`npm notice Publishing to ${process.argv.find((a, i) => process.argv[i - 1] === '--registry') ?? 'default registry'}`);
  console.log(`npm notice`);
}

// Check for simulated failure
if (process.env.MOCK_NPM_FAIL === 'true') {
  console.error('npm ERR! simulated failure');
  process.exit(1);
}

process.exit(0);
