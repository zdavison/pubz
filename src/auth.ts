import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { debug } from './log.js';

export interface AuthResult {
  authenticated: boolean;
  username?: string;
}

export interface LoginResult {
  success: boolean;
  error?: string;
}

/**
 * Check if user is logged into npm for the given registry
 */
export async function checkNpmAuth(registry: string): Promise<AuthResult> {
  return new Promise((resolve) => {
    // Run from home dir to avoid project .npmrc files that may contain
    // CI-only auth tokens (e.g. ${NPM_TOKEN}) which override user auth
    const proc = spawn('npm', ['whoami', '--registry', registry], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: homedir(),
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        resolve({ authenticated: true, username: stdout.trim() });
      } else {
        debug(`npm whoami failed: code=${code}, stdout=${JSON.stringify(stdout)}, stderr=${JSON.stringify(stderr)}`);
        resolve({ authenticated: false });
      }
    });
  });
}

/**
 * Trigger interactive npm login for the given registry
 */
export async function npmLogin(registry: string): Promise<LoginResult> {
  return new Promise((resolve) => {
    debug(`spawning: npm login --registry ${registry}`);
    // Run from home dir so the token is written to ~/.npmrc and not
    // overridden by a project .npmrc with CI-only auth tokens
    const proc = spawn('npm', ['login', '--registry', registry], {
      stdio: 'inherit',
      cwd: homedir(),
    });

    proc.on('close', (code) => {
      debug(`npm login exited: code=${code}`);
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({ success: false, error: 'Login failed or was cancelled' });
      }
    });
  });
}

