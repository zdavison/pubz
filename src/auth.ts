import { spawn } from 'node:child_process';

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
 * Re-authenticate via npm login for 2FA verification (security keys, etc.)
 * Returns true if re-authentication succeeded
 */
export async function reauthenticate(registry: string): Promise<boolean> {
  const loginResult = await npmLogin(registry);
  return loginResult.success;
}
