import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { debug } from './log.js';

/**
 * Resolve Claude credentials from available sources, setting
 * CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY in process.env.
 *
 * Resolution order (first match wins):
 *   1. CLAUDE_CODE_OAUTH_TOKEN env var (already set)
 *   2. ~/.claude/agent-oauth-token flat file
 *   3. macOS Keychain (darwin only) — Claude Code stores OAuth here
 *   4. ~/.claude.json — Claude Code stores OAuth here on Linux
 *
 * OAuth always wins: if an OAuth token is found, ANTHROPIC_API_KEY is removed.
 */
async function resolveCredentials(): Promise<void> {
	const home = process.env.HOME ?? '';

	if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
		// 1. Try the flat file (explicit override)
		try {
			const tokenFile = join(home, '.claude', 'agent-oauth-token');
			const token = (await readFile(tokenFile, 'utf-8')).trim();
			if (token) {
				process.env.CLAUDE_CODE_OAUTH_TOKEN = token;
			}
		} catch { /* ignore — file absent */ }
	}

	if (!process.env.CLAUDE_CODE_OAUTH_TOKEN && process.platform === 'darwin') {
		// 2. Read from macOS Keychain where Claude Code stores subscription OAuth
		try {
			const token = await new Promise<string | null>((resolve) => {
				const proc = spawn('security', [
					'find-generic-password', '-s', 'Claude Code-credentials', '-w',
				], { stdio: ['ignore', 'pipe', 'pipe'] });

				let stdout = '';
				proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
				proc.on('close', (code) => {
					if (code !== 0) return resolve(null);
					try {
						const creds = JSON.parse(stdout.trim());
						const accessToken = creds?.claudeAiOauth?.accessToken;
						resolve(typeof accessToken === 'string' && accessToken.length > 0 ? accessToken : null);
					} catch {
						resolve(null);
					}
				});
				proc.on('error', () => resolve(null));
			});
			if (token) {
				process.env.CLAUDE_CODE_OAUTH_TOKEN = token;
			}
		} catch { /* ignore */ }
	}

	if (!process.env.CLAUDE_CODE_OAUTH_TOKEN) {
		// 3. Read from ~/.claude.json (Linux fallback)
		try {
			const raw = await readFile(join(home, '.claude.json'), 'utf-8');
			const creds = JSON.parse(raw);
			const accessToken = creds?.claudeAiOauth?.accessToken;
			if (typeof accessToken === 'string' && accessToken.length > 0) {
				process.env.CLAUDE_CODE_OAUTH_TOKEN = accessToken;
			}
		} catch { /* ignore */ }
	}

	// OAuth always wins over API key
	if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
		delete process.env.ANTHROPIC_API_KEY;
	}
}

/**
 * Check if the `claude` CLI is available on PATH.
 */
export async function isClaudeAvailable(): Promise<boolean> {
	return new Promise((resolve) => {
		const proc = spawn('which', ['claude'], {
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		proc.on('close', (code) => resolve(code === 0));
		proc.on('error', () => resolve(false));
	});
}

/**
 * Run a prompt through the `claude` CLI and return the output.
 * Resolves credentials before invoking so that the user's subscription is used.
 */
export async function runClaudePrompt(prompt: string): Promise<string | null> {
	await resolveCredentials();

	return new Promise((resolve) => {
		const proc = spawn('claude', ['-p', prompt, '--no-session-persistence'], {
			stdio: ['ignore', 'pipe', 'pipe'],
			cwd: '/tmp',
		});

		let output = '';
		let stderr = '';
		proc.stdout?.on('data', (data: Buffer) => {
			output += data.toString();
		});
		proc.stderr?.on('data', (data: Buffer) => {
			stderr += data.toString();
		});
		proc.on('close', (code: number | null) => {
			if (code === 0 && output.trim()) {
				resolve(output.trim());
			} else {
				debug(`claude CLI exited with code ${code}`);
				if (stderr.trim()) {
					debug(`claude stderr: ${stderr.trim()}`);
				}
				if (!output.trim() && code === 0) {
					debug('claude CLI returned empty output');
				}
				resolve(null);
			}
		});
		proc.on('error', (err) => {
			debug(`Failed to spawn claude CLI: ${err.message}`);
			resolve(null);
		});
	});
}
