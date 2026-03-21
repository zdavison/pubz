#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bold,
  cyan,
  dim,
  frameFooter,
  frameHeader,
  frameLine,
  green,
  muted,
  red,
  yellow,
} from './colors.js';
import { discoverPackages, sortByDependencyOrder } from './discovery.js';
import { closePrompt, confirm, multiSelect, pausePrompt, prompt, resetPrompt, select } from './prompts.js';
import { checkNpmAuth, npmLogin } from './auth.js';
import { debug, setVerbose } from './log.js';
import {
  commitVersionBump,
  createGitTag,
  hasUncommittedChanges,
  publishPackage,
  pushGitTag,
  runBuild,
  verifyBuild,
  type PublishContext,
} from './publish.js';
import { generateChangelog, createGitHubRelease, generateAIReleaseNotes } from './changelog.js';
import { isClaudeAvailable } from './claude.js';
import type { PublishOptions, VersionBumpType } from './types.js';
import {
  bumpVersion,
  isValidVersion,
  previewBump,
  restoreWorkspaceProtocol,
  transformWorkspaceProtocolForPublish,
  updateLocalDependencyVersions,
  updatePackageVersion,
} from './version.js';

const REGISTRIES = {
  npm: 'https://registry.npmjs.org',
  github: 'https://npm.pkg.github.com',
} as const;

function getVersion(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pkgPath = join(__dirname, '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  return pkg.version;
}

function printUsage() {
  console.log(`pubz - Interactive npm package publisher

Usage: pubz [command] [options]

Commands:
  version                Show version number

Options:
  --dry-run              Show what would be published without actually publishing
  --registry <url>       Specify npm registry URL (default: public npm)
  --otp <code>           One-time password for 2FA
  --skip-build           Skip the build step
  --yes, -y              Skip yes/no confirmation prompts (still asks for choices)
  --ci                   CI mode: skip all prompts, auto-accept everything
  --version <value>      Version bump type (patch|minor|major) or explicit version (required with --ci)
  --verbose              Show debug logging
  -h, --help             Show this help message

Examples:
  pubz                                           # Interactive publish
  pubz --dry-run                                 # Preview what would happen
  pubz --registry https://npm.pkg.github.com    # Publish to GitHub Packages
  pubz --ci --version patch                      # CI mode with patch bump
  pubz --ci --version 1.2.3                      # CI mode with explicit version
`);
}

function parseArgs(args: string[]): PublishOptions & { help: boolean } {
  const options: PublishOptions & { help: boolean } = {
    dryRun: false,
    registry: '',
    otp: '',
    skipBuild: false,
    skipConfirms: false,
    ci: false,
    version: '',
    verbose: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--registry':
        options.registry = args[++i] || '';
        break;
      case '--otp':
        options.otp = args[++i] || '';
        break;
      case '--skip-build':
        options.skipBuild = true;
        break;
      case '--yes':
      case '-y':
        options.skipConfirms = true;
        break;
      case '--ci':
        options.ci = true;
        break;
      case '--version':
        options.version = args[++i] || '';
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '-h':
      case '--help':
        options.help = true;
        break;
    }
  }

  return options;
}

async function main() {
  // Handle 'version' command
  if (process.argv[2] === 'version') {
    console.log(getVersion());
    process.exit(0);
  }

  const options = parseArgs(process.argv.slice(2));
  setVerbose(options.verbose);

  if (options.help) {
    printUsage();
    process.exit(0);
  }

  // CI mode validation
  if (options.ci && !options.version) {
    console.error(red(bold('Error:')) + ' --ci requires --version to be specified');
    console.log('');
    console.log(muted('Examples:'));
    console.log(muted('  pubz --ci --version patch'));
    console.log(muted('  pubz --ci --version minor'));
    console.log(muted('  pubz --ci --version major'));
    console.log(muted('  pubz --ci --version 1.2.3'));
    process.exit(1);
  }

  const skipConfirms = options.skipConfirms || options.ci;
  const skipAllPrompts = options.ci;

  const cwd = process.cwd();

  if (options.dryRun) {
    console.log(yellow(bold('⚠️  DRY RUN')) + dim(' — no actual changes will be made'));
    console.log('');
  }

  console.log('📦 ' + bold('pubz') + dim('  npm package publisher'));
  console.log('');

  // Check for uncommitted changes
  const uncommitted = await hasUncommittedChanges(cwd);
  if (uncommitted.hasChanges && !options.dryRun) {
    console.error(red(bold('Error:')) + ' You have uncommitted changes:');
    console.log('');
    for (const file of uncommitted.files.slice(0, 10)) {
      console.log(`  ${yellow(file)}`);
    }
    if (uncommitted.files.length > 10) {
      console.log(dim(`  ... and ${uncommitted.files.length - 10} more`));
    }
    console.log('');
    console.log(muted('Please commit or stash your changes before publishing.'));
    closePrompt();
    process.exit(1);
  }

  // Discover packages
  let packages = await discoverPackages(cwd);
  const publishablePackages = packages.filter((p) => !p.isPrivate);

  if (publishablePackages.length === 0) {
    console.log(yellow('No publishable packages found.'));
    console.log('');
    console.log(muted('Make sure your packages:'));
    console.log(muted('  - Have a package.json with a "name" field'));
    console.log(muted('  - Do not have "private": true'));
    console.log('');
    process.exit(1);
  }

  packages = sortByDependencyOrder(publishablePackages);

  frameHeader('Packages');
  for (const pkg of packages) {
    const deps =
      pkg.localDependencies.length > 0
        ? dim(` (depends on: ${pkg.localDependencies.join(', ')})`)
        : '';
    frameLine(`${dim('•')} ${cyan(pkg.name)}${dim('@')}${yellow(pkg.version)}${deps}`);
  }
  frameFooter();
  console.log('');

  // Package selection (skip if only one package or --ci flag)
  if (packages.length > 1 && !skipAllPrompts) {
    const selectedPackages = await multiSelect(
      'Select packages to publish:',
      packages.map((pkg) => ({
        label: `${pkg.name}@${pkg.version}`,
        value: pkg,
      })),
    );

    if (selectedPackages.length === 0) {
      console.log(yellow('No packages selected. Exiting.'));
      closePrompt();
      process.exit(0);
    }

    packages = sortByDependencyOrder(selectedPackages);
    console.log('');
  }

  // Get current version (use first package as source of truth)
  const currentVersion = packages[0].version;

  // ── Version ────────────────────────────────────────────────────────────────

  let newVersion = currentVersion;
  let didBump = false;

  if (options.version) {
    const bumpTypes = ['patch', 'minor', 'major'] as const;
    const isBumpType = bumpTypes.includes(options.version as (typeof bumpTypes)[number]);

    if (isBumpType) {
      newVersion = bumpVersion(currentVersion, options.version as VersionBumpType);
      didBump = true;
    } else {
      const cleaned = options.version.startsWith('v') ? options.version.slice(1) : options.version;
      if (!isValidVersion(cleaned)) {
        console.error(red(bold('Error:')) + ` Invalid version "${options.version}". Expected format: major.minor.patch (e.g. 1.2.3, 1.2.3-beta)`);
        closePrompt();
        process.exit(1);
      }
      newVersion = cleaned;
      didBump = true;
    }
  } else if (!skipAllPrompts) {
    console.log(`Current version: ${yellow(currentVersion)}`);
    console.log('');

    const shouldBump = skipConfirms || (await confirm('Bump version before publishing?'));

    if (shouldBump) {
      const bumpChoice = await select<VersionBumpType | 'custom'>(
        'Select version bump type:',
        [
          { label: `patch (${previewBump(currentVersion, 'patch')})`, value: 'patch' },
          { label: `minor (${previewBump(currentVersion, 'minor')})`, value: 'minor' },
          { label: `major (${previewBump(currentVersion, 'major')})`, value: 'major' },
          { label: 'custom version', value: 'custom' },
        ],
      );

      if (bumpChoice === 'custom') {
        let customVersion = '';
        while (!customVersion) {
          const input = await prompt(`  Enter version: `);
          const cleaned = input.startsWith('v') ? input.slice(1) : input;
          if (isValidVersion(cleaned)) {
            customVersion = cleaned;
          } else {
            console.log(yellow('  Invalid version. Expected format: major.minor.patch (e.g. 1.2.3, 1.2.3-beta)'));
          }
        }
        newVersion = customVersion;
      } else {
        newVersion = bumpVersion(currentVersion, bumpChoice);
      }

      didBump = true;
    }

    console.log('');
  }

  if (didBump) {
    frameHeader('🔖 Version');
    if (options.version && ['patch', 'minor', 'major'].includes(options.version)) {
      frameLine(`Bumping (${options.version}): ${yellow(currentVersion)} → ${green(newVersion)}`);
    } else {
      frameLine(`${yellow(currentVersion)} → ${green(newVersion)}`);
    }
    frameLine(dim('Updating all packages...'));

    for (const pkg of packages) {
      await updatePackageVersion(pkg, newVersion, options.dryRun);
    }
    await updateLocalDependencyVersions(packages, newVersion, options.dryRun);
    for (const pkg of packages) {
      pkg.version = newVersion;
    }

    const commitResult = await commitVersionBump(newVersion, cwd, options.dryRun);
    if (!commitResult.success) {
      frameFooter();
      console.error(red(bold('Failed to commit version bump:')) + ` ${commitResult.error}`);
      closePrompt();
      process.exit(1);
    }

    frameFooter();
    console.log('');
  }

  // ── Registry ───────────────────────────────────────────────────────────────

  let registry = options.registry;

  if (!registry && !skipAllPrompts) {
    registry = await select('Select publish target:', [
      {
        label: 'Public npm registry (https://registry.npmjs.org)',
        value: REGISTRIES.npm,
      },
      {
        label: 'GitHub Packages (https://npm.pkg.github.com)',
        value: REGISTRIES.github,
      },
    ]);
    console.log('');
  }

  registry = registry || REGISTRIES.npm;

  // ── Build ──────────────────────────────────────────────────────────────────

  if (!options.skipBuild) {
    frameHeader('🏗️  Build');
    frameLine(dim('Running bun run build...'));
    frameLine();

    const buildResult = await runBuild(cwd, options.dryRun);
    if (!buildResult.success) {
      frameFooter();
      console.error(red(bold('Build failed:')) + ` ${buildResult.error}`);
      closePrompt();
      process.exit(1);
    }

    let allBuildsVerified = true;
    for (const pkg of packages) {
      const result = await verifyBuild(pkg);
      if (result.success) {
        frameLine(`  ${green('✓')} ${pkg.name}`);
      } else {
        frameLine(`  ${red('✗')} ${pkg.name}: ${result.error}`);
        allBuildsVerified = false;
      }
    }

    frameFooter();
    console.log('');

    if (!allBuildsVerified) {
      console.error(red('Build verification failed.') + muted(' Please fix the issues and try again.'));
      closePrompt();
      process.exit(1);
    }
  }

  // ── Publish ────────────────────────────────────────────────────────────────

  if (options.dryRun) {
    console.log(yellow('[DRY RUN]') + ` Would publish to ${cyan(registry)}:`);
  } else {
    console.log(`Publishing to ${cyan(registry)}:`);
  }
  console.log('');
  for (const pkg of packages) {
    console.log(`  ${dim('•')} ${cyan(pkg.name)}${dim('@')}${yellow(newVersion)}`);
  }
  console.log('');

  if (!options.dryRun && !skipConfirms) {
    const shouldContinue = await confirm('Continue?');
    if (!shouldContinue) {
      console.log(yellow('Publish cancelled.'));
      closePrompt();
      process.exit(0);
    }
    console.log('');
  }

  frameHeader('🚀 Publish');

  // Auth verification (skip in dry run mode and CI mode)
  if (!options.dryRun && !options.ci) {
    frameLine(dim('Verifying authentication...'));
    const authResult = await checkNpmAuth(registry);

    if (!authResult.authenticated) {
      frameLine(yellow('Not authenticated.') + dim(' Starting login...'));
      frameLine();

      pausePrompt();
      const loginResult = await npmLogin(registry);
      resetPrompt();

      if (!loginResult.success) {
        frameFooter();
        console.error(red(bold('Login failed:')) + ` ${loginResult.error}`);
        closePrompt();
        process.exit(1);
      }

      const verifyAuth = await checkNpmAuth(registry);
      if (!verifyAuth.authenticated) {
        frameFooter();
        console.error(red(bold('Error:')) + ' Login did not complete successfully.');
        closePrompt();
        process.exit(1);
      }

      frameLine(green('Logged in as') + ` ${cyan(verifyAuth.username ?? 'unknown')}`);
      frameLine();
    } else {
      frameLine(dim(`Authenticated as ${cyan(authResult.username ?? 'unknown')}`));
      frameLine();
    }
  }

  frameLine(dim('Preparing packages...'));

  const workspaceTransforms = await transformWorkspaceProtocolForPublish(
    packages,
    newVersion,
    options.dryRun,
  );

  const publishContext: PublishContext = {
    otp: options.otp,
    useBrowserAuth: !options.ci,
    onInteractiveStart: pausePrompt,
    onInteractiveComplete: resetPrompt,
  };

  let publishFailed = false;
  let failedPackageName = '';
  let failedError = '';

  try {
    for (const pkg of packages) {
      if (options.dryRun) {
        frameLine(`  ${dim('[dry run]')} ${cyan(pkg.name)}${dim('@')}${yellow(newVersion)}`);
      } else {
        frameLine(dim(`  Publishing ${pkg.name}...`));
      }

      const result = await publishPackage(pkg, registry, publishContext, options.dryRun);

      if (!result.success) {
        publishFailed = true;
        failedPackageName = pkg.name;
        failedError = result.error ?? 'Unknown error';
        break;
      }

      if (!options.dryRun) {
        frameLine(`  ${green('✓')} ${cyan(pkg.name)}${dim('@')}${yellow(newVersion)}`);
      }
    }
  } finally {
    if (workspaceTransforms.length > 0) {
      await restoreWorkspaceProtocol(workspaceTransforms);
    }
  }

  if (publishFailed) {
    frameFooter();
    console.error(red(bold('Failed to publish')) + ` ${cyan(failedPackageName)}: ${failedError}`);
    console.log('');
    console.error(red('Stopping publish process.'));
    closePrompt();
    process.exit(1);
  }

  frameFooter();
  console.log('');

  if (options.dryRun) {
    console.log(muted('Run without --dry-run to actually publish.'));
    console.log('');
  }

  console.log('✅ ' + green(bold(`Published v${newVersion}!`)));
  console.log('');

  // ── Release ────────────────────────────────────────────────────────────────

  const changelog = await generateChangelog(cwd);

  if (changelog.terminal) {
    console.log(bold('Changes since ') + cyan(changelog.previousTag ?? 'initial') + ':');
    console.log(changelog.terminal);
    console.log('');
  }

  let releaseNotes = changelog.markdown;
  if (!options.ci && changelog.commits.length > 0) {
    const claudeAvailable = await isClaudeAvailable();
    if (claudeAvailable) {
      const useAI = await confirm('Generate release notes with AI (claude)?');
      if (useAI) {
        console.log('');
        console.log(dim('Generating AI release notes...'));
        const aiNotes = await generateAIReleaseNotes(changelog.commits, newVersion);
        if (aiNotes) {
          releaseNotes = aiNotes;
          console.log('');
          console.log(bold('AI-generated release notes:'));
          console.log(aiNotes);
        } else {
          console.log(yellow('AI generation failed, falling back to commit list.') + dim(' (run with --verbose for details)'));
        }
        console.log('');
      }
    }
  }

  if (!options.dryRun) {
    let shouldTag: boolean;
    let shouldPush = false;
    let shouldRelease = false;

    if (options.ci) {
      shouldTag = true;
      shouldPush = true;
      shouldRelease = !!releaseNotes;
    } else {
      shouldTag = skipConfirms || (await confirm(`Create a git tag for ${cyan(`v${newVersion}`)}?`));
      if (shouldTag) {
        shouldPush = skipConfirms || (await confirm('Push tag to origin?'));
        if (shouldPush && releaseNotes) {
          shouldRelease = skipConfirms || (await confirm('Create a GitHub release?'));
        }
      }
      if (shouldTag) console.log('');
    }

    if (shouldTag) {
      frameHeader('🏷️  Release');
      frameLine(dim(`Creating tag v${newVersion}...`));
      const tagResult = await createGitTag(newVersion, cwd, options.dryRun);

      if (tagResult.success) {
        if (shouldPush) {
          frameLine(dim('Pushing tag to origin...'));
          await pushGitTag(newVersion, cwd, options.dryRun);

          if (releaseNotes && shouldRelease) {
            frameLine(dim('Creating GitHub release...'));
            const releaseResult = await createGitHubRelease(
              newVersion,
              releaseNotes,
              cwd,
              options.dryRun,
            );
            if (releaseResult.success && releaseResult.url) {
              frameLine(`  Release: ${cyan(releaseResult.url)}`);
            } else if (!releaseResult.success) {
              frameLine(yellow(releaseResult.error ?? 'Failed to create GitHub release'));
            }
          }
        } else {
          frameLine(`Push manually: ${dim(`git push origin v${newVersion}`)}`);
        }
      } else {
        frameLine(red(tagResult.error ?? 'Failed to create git tag'));
      }

      frameFooter();
      console.log('');
    }
  }

  console.log('🎉 ' + green(bold('Done!')));
  closePrompt();
}

main().catch((error) => {
  console.error(red(bold('Error:')) + ` ${error.message}`);
  closePrompt();
  process.exit(1);
});
