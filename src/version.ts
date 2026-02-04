import { readFile, writeFile } from 'node:fs/promises';
import type {
  DiscoveredPackage,
  PackageJson,
  VersionBumpType,
} from './types.js';

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
