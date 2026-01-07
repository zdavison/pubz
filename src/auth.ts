import { spawn } from 'node:child_process';
import { cyan } from './colors.js';
import { prompt } from './prompts.js';

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
    const proc = spawn('npm', ['whoami', '--registry', registry], {
      stdio: ['inherit', 'pipe', 'pipe'],
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
    const proc = spawn('npm', ['login', '--registry', registry], {
      stdio: 'inherit',
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true });
      } else {
        resolve({ success: false, error: 'Login failed or was cancelled' });
      }
    });
  });
}

/**
 * Prompt user for OTP code from their authenticator app
 */
export async function promptForOtp(): Promise<string> {
  console.log('');
  const code = await prompt(`${cyan('?')} Enter OTP code from your authenticator: `);
  return code.trim();
}
