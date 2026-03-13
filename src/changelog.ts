import { spawn } from 'node:child_process';
import { dim } from './colors.js';

export interface ChangelogCommit {
	sha: string;
	message: string;
}

/**
 * Parse a git remote URL (SSH or HTTPS) into an HTTPS base URL.
 * @returns URL like "https://github.com/owner/repo" or null if unparseable
 */
export function parseGitRemoteUrl(remoteUrl: string): string | null {
	// SSH: git@github.com:owner/repo.git
	const sshMatch = remoteUrl.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
	if (sshMatch) {
		return `https://${sshMatch[1]}/${sshMatch[2]}`;
	}

	// HTTPS: https://github.com/owner/repo.git
	const httpsMatch = remoteUrl.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
	if (httpsMatch) {
		return `https://${httpsMatch[1]}/${httpsMatch[2]}`;
	}

	return null;
}

function runSilent(
	command: string,
	args: string[],
	cwd: string,
): Promise<{ code: number; output: string }> {
	return new Promise((resolve) => {
		const proc = spawn(command, args, {
			cwd,
			stdio: ['ignore', 'pipe', 'pipe'],
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

/**
 * Find the most recent git tag before the current version.
 */
export async function getPreviousTag(cwd: string): Promise<string | null> {
	const result = await runSilent(
		'git',
		['tag', '--sort=-version:refname'],
		cwd,
	);
	if (result.code !== 0) return null;

	const tags = result.output
		.trim()
		.split('\n')
		.filter((t) => t.length > 0);
	return tags[0] ?? null;
}

/**
 * Get the git remote URL for the origin remote.
 */
export async function getRepoUrl(cwd: string): Promise<string | null> {
	const result = await runSilent('git', ['remote', 'get-url', 'origin'], cwd);
	if (result.code !== 0) return null;
	return parseGitRemoteUrl(result.output.trim());
}

/**
 * Get commits between a tag and HEAD (or between two refs).
 */
export async function getCommitsSince(
	ref: string,
	cwd: string,
): Promise<ChangelogCommit[]> {
	const result = await runSilent(
		'git',
		['log', `${ref}..HEAD`, '--oneline', '--no-decorate'],
		cwd,
	);
	if (result.code !== 0) return [];

	return result.output
		.trim()
		.split('\n')
		.filter((line) => line.length > 0)
		.map((line) => {
			const spaceIdx = line.indexOf(' ');
			return {
				sha: line.slice(0, spaceIdx),
				message: line.slice(spaceIdx + 1),
			};
		});
}

function isReleaseCommit(message: string): boolean {
	return /^chore: release v/.test(message);
}

/**
 * Format changelog for terminal output with colored short SHAs.
 */
export function formatChangelogTerminal(commits: ChangelogCommit[]): string {
	const filtered = commits.filter((c) => !isReleaseCommit(c.message));
	if (filtered.length === 0) return '';

	return filtered
		.map((c) => `  ${dim(c.sha)} ${c.message}`)
		.join('\n');
}

/**
 * Format changelog as markdown with clickable SHA links.
 */
export function formatChangelogMarkdown(
	commits: ChangelogCommit[],
	repoUrl: string | null,
): string {
	const filtered = commits.filter((c) => !isReleaseCommit(c.message));
	if (filtered.length === 0) return '';

	return filtered
		.map((c) => {
			const shaRef = repoUrl
				? `[\`${c.sha}\`](${repoUrl}/commit/${c.sha})`
				: `\`${c.sha}\``;
			return `- ${shaRef} ${c.message}`;
		})
		.join('\n');
}

/**
 * Generate full changelog: fetches previous tag, commits, and formats.
 * Returns both terminal and markdown versions.
 */
export async function generateChangelog(
	cwd: string,
): Promise<{
	commits: ChangelogCommit[];
	terminal: string;
	markdown: string;
	previousTag: string | null;
	repoUrl: string | null;
}> {
	const [previousTag, repoUrl] = await Promise.all([
		getPreviousTag(cwd),
		getRepoUrl(cwd),
	]);

	if (!previousTag) {
		return { commits: [], terminal: '', markdown: '', previousTag: null, repoUrl };
	}

	const commits = await getCommitsSince(previousTag, cwd);
	const terminal = formatChangelogTerminal(commits);
	const markdown = formatChangelogMarkdown(commits, repoUrl);

	return { commits, terminal, markdown, previousTag, repoUrl };
}

/**
 * Create a GitHub release using the gh CLI.
 */
export async function createGitHubRelease(
	version: string,
	body: string,
	cwd: string,
	dryRun: boolean,
): Promise<{ success: boolean; url?: string; error?: string }> {
	const tagName = `v${version}`;

	if (dryRun) {
		console.log(`[DRY RUN] Would create GitHub release for ${tagName}`);
		return { success: true };
	}

	const result = await runSilent(
		'gh',
		['release', 'create', tagName, '--title', tagName, '--notes', body],
		cwd,
	);

	if (result.code !== 0) {
		return {
			success: false,
			error: result.output.trim() || `Failed to create GitHub release for ${tagName}`,
		};
	}

	const url = result.output.trim();
	return { success: true, url };
}
