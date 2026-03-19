import { test, expect, describe } from 'bun:test';
import { formatChangelogTerminal, formatChangelogMarkdown, parseGitRemoteUrl } from '../src/changelog.js';

describe('parseGitRemoteUrl', () => {
	test('parses SSH remote URL', () => {
		expect(parseGitRemoteUrl('git@github.com:mm-zacharydavison/pubz.git')).toBe(
			'https://github.com/mm-zacharydavison/pubz',
		);
	});

	test('parses HTTPS remote URL', () => {
		expect(parseGitRemoteUrl('https://github.com/mm-zacharydavison/pubz.git')).toBe(
			'https://github.com/mm-zacharydavison/pubz',
		);
	});

	test('parses HTTPS remote URL without .git suffix', () => {
		expect(parseGitRemoteUrl('https://github.com/mm-zacharydavison/pubz')).toBe(
			'https://github.com/mm-zacharydavison/pubz',
		);
	});

	test('returns null for unparseable URL', () => {
		expect(parseGitRemoteUrl('not-a-url')).toBeNull();
	});
});

const sampleCommits = [
	{ sha: 'abc1234', message: 'Fix workspace dependency resolution' },
	{ sha: 'def5678', message: 'Add support for scoped packages' },
	{ sha: '9990aaa', message: 'chore: release v0.2.12' },
	{ sha: '5fe3f70', message: "Merge branch 'main' of github.com:mm-zacharydavison/pubz" },
];

describe('formatChangelogTerminal', () => {
	test('formats commits with short SHAs', () => {
		const output = formatChangelogTerminal(sampleCommits);
		// Should contain the short SHA and message (no ANSI for exact match, but check structure)
		expect(output).toContain('abc1234');
		expect(output).toContain('Fix workspace dependency resolution');
		expect(output).toContain('def5678');
		expect(output).toContain('Add support for scoped packages');
	});

	test('filters out release commits', () => {
		const output = formatChangelogTerminal(sampleCommits);
		expect(output).not.toContain('chore: release');
	});

	test('filters out merge commits', () => {
		const output = formatChangelogTerminal(sampleCommits);
		expect(output).not.toContain('Merge branch');
	});

	test('returns empty string when all commits are release commits', () => {
		const output = formatChangelogTerminal([
			{ sha: 'abc1234', message: 'chore: release v1.0.0' },
		]);
		expect(output).toBe('');
	});
});

describe('formatChangelogMarkdown', () => {
	const repoUrl = 'https://github.com/mm-zacharydavison/pubz';

	test('formats commits as markdown with clickable SHAs', () => {
		const output = formatChangelogMarkdown(sampleCommits, repoUrl);
		expect(output).toContain('[`abc1234`](https://github.com/mm-zacharydavison/pubz/commit/abc1234)');
		expect(output).toContain('Fix workspace dependency resolution');
	});

	test('filters out release commits', () => {
		const output = formatChangelogMarkdown(sampleCommits, repoUrl);
		expect(output).not.toContain('chore: release');
	});

	test('filters out merge commits', () => {
		const output = formatChangelogMarkdown(sampleCommits, repoUrl);
		expect(output).not.toContain('Merge branch');
	});

	test('formats without links when repoUrl is null', () => {
		const output = formatChangelogMarkdown(sampleCommits, null);
		expect(output).toContain('`abc1234`');
		expect(output).not.toContain('](');
	});
});
