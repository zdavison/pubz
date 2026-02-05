import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

export interface TestWorkspace {
  path: string;
  cleanup: () => void;
  readPackageJson: (relativePath: string) => Record<string, unknown>;
  getNpmCalls: () => NpmCall[];
  npmLogFile: string;
}

export interface NpmCall {
  args: string[];
  cwd: string;
  timestamp: string;
  packageJson?: Record<string, unknown>;
}

/**
 * Creates a test workspace by copying a fixture to a temp directory
 * and initializing git.
 */
export async function createTestWorkspace(
  fixtureName: string,
): Promise<TestWorkspace> {
  const fixturesDir = join(import.meta.dir, '..', 'fixtures');
  const fixturePath = join(fixturesDir, fixtureName);

  if (!existsSync(fixturePath)) {
    throw new Error(`Fixture not found: ${fixturePath}`);
  }

  // Create temp directory
  const tempDir = join(tmpdir(), `pubz-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tempDir, { recursive: true });

  // Copy fixture
  cpSync(fixturePath, tempDir, { recursive: true });

  // Initialize git repo
  await runCommand('git', ['init'], tempDir);
  await runCommand('git', ['config', 'user.email', 'test@test.com'], tempDir);
  await runCommand('git', ['config', 'user.name', 'Test'], tempDir);
  await runCommand('git', ['add', '-A'], tempDir);
  await runCommand('git', ['commit', '-m', 'Initial commit'], tempDir);

  // Create npm log file path
  const npmLogFile = join(tempDir, '.npm-calls.log');

  return {
    path: tempDir,
    npmLogFile,
    cleanup: () => {
      rmSync(tempDir, { recursive: true, force: true });
    },
    readPackageJson: (relativePath: string) => {
      const fullPath = join(tempDir, relativePath, 'package.json');
      return JSON.parse(readFileSync(fullPath, 'utf-8'));
    },
    getNpmCalls: () => {
      if (!existsSync(npmLogFile)) {
        return [];
      }
      const content = readFileSync(npmLogFile, 'utf-8').trim();
      if (!content) return [];
      return content.split('\n').map((line) => JSON.parse(line) as NpmCall);
    },
  };
}

function runCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    let output = '';

    proc.stdout?.on('data', (data) => {
      output += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      output += data.toString();
    });

    proc.on('close', (code) => {
      resolve({ code: code ?? 1, output });
    });
  });
}

export interface PubzResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs pubz CLI with the given arguments in the given workspace.
 */
export async function runPubz(
  workspace: TestWorkspace,
  args: string[],
  env: Record<string, string> = {},
): Promise<PubzResult> {
  const cliPath = join(import.meta.dir, '..', '..', 'dist', 'cli.js');
  const mockNpmPath = join(import.meta.dir, 'mock-npm');

  return new Promise((resolve) => {
    const proc = spawn('bun', [cliPath, ...args], {
      cwd: workspace.path,
      env: {
        ...process.env,
        PUBZ_NPM_COMMAND: mockNpmPath,
        MOCK_NPM_LOG: workspace.npmLogFile,
        // Disable colors for easier testing
        NO_COLOR: '1',
        ...env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    // Close stdin to prevent hanging on prompts
    proc.stdin?.end();

    proc.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}
