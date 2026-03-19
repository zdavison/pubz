#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bold,
  cyan,
  dim,
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
import { generateChangelog, createGitHubRelease, generateAIReleaseNotes, isClaudeAvailable } from './changelog.js';
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
  console.log(`
pubz - Interactive npm package publisher

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

  // Helper to check if we should skip confirmations
  const skipConfirms = options.skipConfirms || options.ci;
  // Helper to check if we should skip all prompts (including selections)
  const skipAllPrompts = options.ci;

  const cwd = process.cwd();

  if (options.dryRun) {
    console.log(yellow(bold('DRY RUN MODE')) + dim(' - No actual changes will be made'));
    console.log('');
  }

  console.log(bold('pubz') + dim(' - npm package publisher'));
  console.log(dim('═'.repeat(30)));
  console.log('');

  // Check for uncommitted changes
  const uncommitted = await hasUncommittedChanges(cwd);
  if (uncommitted.hasChanges && !options.dryRun) {
    console.log(red(bold('Error:')) + ' You have uncommitted changes:');
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
  console.log(cyan('Discovering packages...'));
  console.log('');

  let packages = await discoverPackages(cwd);

  // Filter out private packages
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

  // Sort by dependency order
  packages = sortByDependencyOrder(publishablePackages);

  console.log(`Found ${green(bold(String(packages.length)))} publishable package(s):`);
  console.log('');
  for (const pkg of packages) {
    const deps =
      pkg.localDependencies.length > 0
        ? dim(` (depends on: ${pkg.localDependencies.join(', ')})`)
        : '';
    console.log(`  ${dim('•')} ${cyan(pkg.name)}${dim('@')}${yellow(pkg.version)}${deps}`);
  }
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

  // Step 1: Version Management
  console.log(bold(cyan('Step 1:')) + ' Version Management');
  console.log(dim('─'.repeat(30)));
  console.log('');
  console.log(`Current version: ${yellow(currentVersion)}`);
  console.log('');

  let newVersion = currentVersion;

  // Handle version from --version flag (bump type or explicit version)
  if (options.version) {
    const bumpTypes = ['patch', 'minor', 'major'] as const;
    const isBumpType = bumpTypes.includes(options.version as (typeof bumpTypes)[number]);

    if (isBumpType) {
      newVersion = bumpVersion(currentVersion, options.version as VersionBumpType);
      console.log(`Bumping version (${options.version}): ${yellow(currentVersion)} → ${green(newVersion)}`);
    } else {
      const cleaned = options.version.startsWith('v') ? options.version.slice(1) : options.version;
      if (!isValidVersion(cleaned)) {
        console.error(red(bold('Error:')) + ` Invalid version "${options.version}". Expected format: major.minor.patch (e.g. 1.2.3, 1.2.3-beta)`);
        closePrompt();
        process.exit(1);
      }
      newVersion = cleaned;
      console.log(`Using explicit version: ${green(newVersion)}`);
    }
    console.log('');

    console.log(`Updating version to ${green(newVersion)} in all packages...`);
    console.log('');

    for (const pkg of packages) {
      await updatePackageVersion(pkg, newVersion, options.dryRun);
    }

    // Update local dependency versions
    await updateLocalDependencyVersions(packages, newVersion, options.dryRun);

    // Update in-memory versions
    for (const pkg of packages) {
      pkg.version = newVersion;
    }

    // Commit version bump
    const commitResult = await commitVersionBump(newVersion, cwd, options.dryRun);
    if (!commitResult.success) {
      console.error(red(bold('Failed to commit version bump:')) + ` ${commitResult.error}`);
      closePrompt();
      process.exit(1);
    }

    console.log('');
  } else if (!skipAllPrompts) {
    // With --yes: skip the confirmation but still ask for bump type
    // Without --yes: ask both confirmation and bump type
    const shouldBump = skipConfirms || (await confirm('Bump version before publishing?'));

    if (shouldBump) {
      const bumpChoice = await select<VersionBumpType | 'custom'>(
        'Select version bump type:',
        [
          {
            label: `patch (${previewBump(currentVersion, 'patch')})`,
            value: 'patch',
          },
          {
            label: `minor (${previewBump(currentVersion, 'minor')})`,
            value: 'minor',
          },
          {
            label: `major (${previewBump(currentVersion, 'major')})`,
            value: 'major',
          },
          {
            label: 'custom version',
            value: 'custom',
          },
        ],
      );

      if (bumpChoice === 'custom') {
        let customVersion = '';
        while (!customVersion) {
          const input = await prompt(`  Enter version: `);
          // Strip leading 'v' prefix if provided
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

      console.log('');
      console.log(`Updating version to ${green(newVersion)} in all packages...`);
      console.log('');

      for (const pkg of packages) {
        await updatePackageVersion(pkg, newVersion, options.dryRun);
      }

      // Update local dependency versions
      await updateLocalDependencyVersions(packages, newVersion, options.dryRun);

      // Update in-memory versions
      for (const pkg of packages) {
        pkg.version = newVersion;
      }

      // Commit version bump
      const commitResult = await commitVersionBump(newVersion, cwd, options.dryRun);
      if (!commitResult.success) {
        console.error(red(bold('Failed to commit version bump:')) + ` ${commitResult.error}`);
        closePrompt();
        process.exit(1);
      }

      console.log('');
    }
  }

  // Step 2: Registry Selection
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
  }

  registry = registry || REGISTRIES.npm;

  console.log('');
  console.log(`Publishing to: ${cyan(registry)}`);
  console.log('');

  // Auth verification (skip in dry run mode and CI mode)
  // In CI mode, skip auth check because:
  // - OIDC Trusted Publishing authenticates at publish time, not beforehand
  // - If auth is misconfigured, the publish command will fail with a clear error
  if (!options.dryRun && !options.ci) {
    console.log(cyan('Verifying npm authentication...'));
    const authResult = await checkNpmAuth(registry);

    if (!authResult.authenticated) {
      console.log('');
      console.log(yellow('Not logged in to npm.') + ' Starting login...');
      console.log('');

      pausePrompt();
      const loginResult = await npmLogin(registry);
      resetPrompt();
      if (!loginResult.success) {
        console.error(red(bold('Login failed:')) + ` ${loginResult.error}`);
        closePrompt();
        process.exit(1);
      }

      // Verify login succeeded
      const verifyAuth = await checkNpmAuth(registry);
      if (!verifyAuth.authenticated) {
        console.error(red(bold('Error:')) + ' Login did not complete successfully.');
        closePrompt();
        process.exit(1);
      }

      console.log('');
      console.log(green('Logged in as') + ` ${cyan(verifyAuth.username ?? 'unknown')}`);
    } else {
      console.log(green('Authenticated as') + ` ${cyan(authResult.username ?? 'unknown')}`);
    }
    console.log('');
  }

  // Step 3: Build
  if (!options.skipBuild) {
    console.log(bold(cyan('Step 2:')) + ' Building Packages');
    console.log(dim('─'.repeat(30)));
    console.log('');

    const buildResult = await runBuild(cwd, options.dryRun);
    if (!buildResult.success) {
      console.error(red(bold('Build failed:')) + ` ${buildResult.error}`);
      closePrompt();
      process.exit(1);
    }

    console.log('');
    console.log(cyan('Verifying builds...'));
    console.log('');

    let allBuildsVerified = true;
    for (const pkg of packages) {
      const result = await verifyBuild(pkg);
      if (result.success) {
        console.log(`  ${green('✓')} ${pkg.name} build verified`);
      } else {
        console.error(`  ${red('✗')} ${pkg.name}: ${result.error}`);
        allBuildsVerified = false;
      }
    }

    console.log('');

    if (!allBuildsVerified) {
      console.error(
        red('Build verification failed.') + muted(' Please fix the issues and try again.'),
      );
      closePrompt();
      process.exit(1);
    }
  }

  // Step 4: Publish
  console.log(bold(cyan('Step 3:')) + ' Publishing to npm');
  console.log(dim('─'.repeat(30)));
  console.log('');

  if (options.dryRun) {
    console.log(
      yellow('[DRY RUN]') + ` Would publish the following packages to ${cyan(registry)}:`,
    );
  } else {
    console.log('About to publish the following packages:');
  }
  console.log('');
  for (const pkg of packages) {
    console.log(`  ${dim('•')} ${cyan(pkg.name)}${dim('@')}${yellow(newVersion)}`);
  }
  console.log('');
  console.log(`Registry: ${cyan(registry)}`);
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

  console.log(cyan('Preparing packages for publish...'));
  console.log('');

  // Transform workspace: references to actual versions for publishing
  const workspaceTransforms = await transformWorkspaceProtocolForPublish(
    packages,
    newVersion,
    options.dryRun,
  );

  if (workspaceTransforms.length > 0 || options.dryRun) {
    console.log('');
  }

  console.log(cyan('Publishing packages...'));
  console.log('');

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
      const result = await publishPackage(pkg, registry, publishContext, options.dryRun);
      if (!result.success) {
        publishFailed = true;
        failedPackageName = pkg.name;
        failedError = result.error ?? 'Unknown error';
        break;
      }
    }
  } finally {
    // Restore workspace: references
    if (workspaceTransforms.length > 0) {
      console.log('');
      await restoreWorkspaceProtocol(workspaceTransforms);
    }
  }

  if (publishFailed) {
    console.error(red(bold('Failed to publish')) + ` ${cyan(failedPackageName)}: ${failedError}`);
    console.log('');
    console.log(red('Stopping publish process.'));
    closePrompt();
    process.exit(1);
  }

  if (options.dryRun) {
    console.log('');
    console.log(muted('Run without --dry-run to actually publish.'));
  }

  console.log('');
  console.log(dim('═'.repeat(30)));
  console.log(green(bold('Publishing complete!')));
  console.log('');
  console.log(`Published version: ${green(bold(newVersion))}`);
  console.log('');

  // Step 5: Git tagging & release
  const changelog = await generateChangelog(cwd);

  if (changelog.terminal) {
    console.log(bold('Changes since ') + cyan(changelog.previousTag ?? 'initial') + bold(':'));
    console.log(changelog.terminal);
    console.log('');
  }

  // Optionally generate AI release notes if claude CLI is available
  let releaseNotes = changelog.markdown;
  if (!options.ci && changelog.commits.length > 0) {
    const claudeAvailable = await isClaudeAvailable();
    if (claudeAvailable) {
      const useAI = await confirm('Generate release notes with AI (claude)?');
      if (useAI) {
        console.log(cyan('Generating AI release notes...'));
        const aiNotes = await generateAIReleaseNotes(changelog.commits, newVersion);
        if (aiNotes) {
          releaseNotes = aiNotes;
          console.log('');
          console.log(bold('AI-generated release notes:'));
          console.log(aiNotes);
          console.log('');
        } else {
          console.log(yellow('AI generation failed, falling back to commit list.') + dim(' (run with --verbose for details)'));
        }
      }
    }
  }

  if (!options.dryRun) {
    if (options.ci) {
      // In CI mode, automatically create and push git tag
      console.log(cyan('Creating git tag...'));
      const tagResult = await createGitTag(newVersion, cwd, options.dryRun);

      if (tagResult.success) {
        console.log(cyan('Pushing tag to origin...'));
        await pushGitTag(newVersion, cwd, options.dryRun);

        if (releaseNotes) {
          console.log(cyan('Creating GitHub release...'));
          const releaseResult = await createGitHubRelease(
            newVersion,
            releaseNotes,
            cwd,
            options.dryRun,
          );
          if (releaseResult.success && releaseResult.url) {
            console.log(`  Release created: ${cyan(releaseResult.url)}`);
          } else if (!releaseResult.success) {
            console.error(yellow(releaseResult.error ?? 'Failed to create GitHub release'));
          }
        }
      } else {
        console.error(red(tagResult.error ?? 'Failed to create git tag'));
      }
      console.log('');
    } else {
      const shouldTag = skipConfirms || await confirm(`Create a git tag for ${cyan(`v${newVersion}`)}?`);

      if (shouldTag) {
        console.log('');
        const tagResult = await createGitTag(newVersion, cwd, options.dryRun);

        if (tagResult.success) {
          const shouldPush = skipConfirms || await confirm('Push tag to origin?');
          if (shouldPush) {
            await pushGitTag(newVersion, cwd, options.dryRun);

            if (releaseNotes) {
              const shouldRelease = skipConfirms || await confirm('Create a GitHub release?');
              if (shouldRelease) {
                const releaseResult = await createGitHubRelease(
                  newVersion,
                  releaseNotes,
                  cwd,
                  options.dryRun,
                );
                if (releaseResult.success && releaseResult.url) {
                  console.log(`  Release created: ${cyan(releaseResult.url)}`);
                } else if (!releaseResult.success) {
                  console.error(yellow(releaseResult.error ?? 'Failed to create GitHub release'));
                }
              }
            }
          } else {
            console.log(
              `Tag created locally. Push manually with: ${dim(`git push origin v${newVersion}`)}`,
            );
          }
        } else {
          console.error(red(tagResult.error ?? 'Failed to create git tag'));
        }
        console.log('');
      }
    }
  }

  console.log(green(bold('Done!')));
  closePrompt();
}

main().catch((error) => {
  console.error(red(bold('Error:')) + ` ${error.message}`);
  closePrompt();
  process.exit(1);
});
