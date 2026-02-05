import { readFile, writeFile } from 'node:fs/promises';
import type {
  DiscoveredPackage,
  PackageJson,
  VersionBumpType,
} from './types.js';

export interface WorkspaceTransform {
  packageJsonPath: string;
  depType: 'dependencies' | 'devDependencies' | 'peerDependencies';
  depName: string;
  originalValue: string;
}

/**
 * Transforms workspace: protocol references to actual versions for publishing.
 * Returns a list of transforms that can be used to restore the original values.
 */
export async function transformWorkspaceProtocolForPublish(
  packages: DiscoveredPackage[],
  newVersion: string,
  dryRun: boolean,
): Promise<WorkspaceTransform[]> {
  const packageNames = new Set(packages.map((p) => p.name));
  const transforms: WorkspaceTransform[] = [];

  for (const pkg of packages) {
    const content = await readFile(pkg.packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(content) as PackageJson;
    let modified = false;

    for (const depType of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
    ] as const) {
      const deps = packageJson[depType];
      if (!deps) continue;

      for (const depName of Object.keys(deps)) {
        if (packageNames.has(depName)) {
          const oldVersion = deps[depName];

          if (oldVersion.startsWith('workspace:')) {
            // Transform workspace:^ -> ^version, workspace:~ -> ~version, workspace:* -> version
            const modifier = oldVersion.replace('workspace:', '');
            const newVersionSpec =
              modifier === '*' || modifier === ''
                ? newVersion
                : `${modifier}${newVersion}`;

            if (dryRun) {
              console.log(
                `  [DRY RUN] Would temporarily transform ${pkg.name} ${depType}.${depName}: ${oldVersion} -> ${newVersionSpec}`,
              );
            } else {
              transforms.push({
                packageJsonPath: pkg.packageJsonPath,
                depType,
                depName,
                originalValue: oldVersion,
              });
              deps[depName] = newVersionSpec;
              modified = true;
            }
          }
        }
      }
    }

    if (modified && !dryRun) {
      await writeFile(
        pkg.packageJsonPath,
        `${JSON.stringify(packageJson, null, 2)}\n`,
      );
      console.log(`  Transformed workspace references in ${pkg.name}`);
    }
  }

  return transforms;
}

/**
 * Restores workspace: protocol references after publishing.
 */
export async function restoreWorkspaceProtocol(
  transforms: WorkspaceTransform[],
): Promise<void> {
  // Group transforms by package.json path to minimize file reads/writes
  const byPath = new Map<string, WorkspaceTransform[]>();
  for (const transform of transforms) {
    const existing = byPath.get(transform.packageJsonPath) ?? [];
    existing.push(transform);
    byPath.set(transform.packageJsonPath, existing);
  }

  for (const [packageJsonPath, pathTransforms] of byPath) {
    const content = await readFile(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(content) as PackageJson;

    for (const transform of pathTransforms) {
      const deps = packageJson[transform.depType];
      if (deps) {
        deps[transform.depName] = transform.originalValue;
      }
    }

    await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  }

  if (transforms.length > 0) {
    console.log(`  Restored workspace references in ${byPath.size} package(s)`);
  }
}

export function bumpVersion(version: string, type: VersionBumpType): string {
  if (type === 'none') return version;

  const [major, minor, patch] = version.split('.').map(Number);

  switch (type) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
  }
}

export function previewBump(version: string, type: VersionBumpType): string {
  const newVersion = bumpVersion(version, type);
  return `${version} -> ${newVersion}`;
}

export async function updatePackageVersion(
  pkg: DiscoveredPackage,
  newVersion: string,
  dryRun: boolean,
): Promise<void> {
  const content = await readFile(pkg.packageJsonPath, 'utf-8');
  const packageJson = JSON.parse(content) as PackageJson;

  packageJson.version = newVersion;

  if (dryRun) {
    console.log(
      `  [DRY RUN] Would update ${pkg.name}: ${pkg.version} -> ${newVersion}`,
    );
    return;
  }

  await writeFile(
    pkg.packageJsonPath,
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );
  console.log(`  Updated ${pkg.name}: ${pkg.version} -> ${newVersion}`);
}

export async function updateLocalDependencyVersions(
  packages: DiscoveredPackage[],
  newVersion: string,
  dryRun: boolean,
): Promise<void> {
  const packageNames = new Set(packages.map((p) => p.name));

  for (const pkg of packages) {
    const content = await readFile(pkg.packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(content) as PackageJson;
    let modified = false;

    // Update dependencies, devDependencies, and peerDependencies
    for (const depType of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
    ] as const) {
      const deps = packageJson[depType];
      if (!deps) continue;

      for (const depName of Object.keys(deps)) {
        if (packageNames.has(depName)) {
          const oldVersion = deps[depName];

          // Skip workspace protocol - package manager handles this at publish time
          if (oldVersion.startsWith('workspace:')) {
            continue;
          }

          const newVersionSpec = oldVersion.startsWith('^')
            ? `^${newVersion}`
            : oldVersion.startsWith('~')
              ? `~${newVersion}`
              : newVersion;

          if (deps[depName] !== newVersionSpec) {
            if (dryRun) {
              console.log(
                `  [DRY RUN] Would update ${pkg.name} ${depType}.${depName}: ${oldVersion} -> ${newVersionSpec}`,
              );
            } else {
              deps[depName] = newVersionSpec;
              modified = true;
            }
          }
        }
      }
    }

    if (modified && !dryRun) {
      await writeFile(
        pkg.packageJsonPath,
        `${JSON.stringify(packageJson, null, 2)}\n`,
      );
      console.log(`  Updated local dependency versions in ${pkg.name}`);
    }
  }
}
