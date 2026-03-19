import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { glob } from './glob.js';
import type { DiscoveredPackage, PackageJson } from './types.js';

export async function findRootPackageJson(cwd: string): Promise<string | null> {
  const packageJsonPath = join(cwd, 'package.json');

  try {
    await stat(packageJsonPath);
    return packageJsonPath;
  } catch {
    return null;
  }
}

export async function readPackageJson(path: string): Promise<PackageJson> {
  const content = await readFile(path, 'utf-8');
  return JSON.parse(content) as PackageJson;
}

function getWorkspacePatterns(packageJson: PackageJson): string[] {
  if (!packageJson.workspaces) {
    return [];
  }

  if (Array.isArray(packageJson.workspaces)) {
    return packageJson.workspaces;
  }

  return packageJson.workspaces.packages || [];
}

export async function discoverPackages(
  cwd: string,
): Promise<DiscoveredPackage[]> {
  const rootPackageJsonPath = await findRootPackageJson(cwd);

  if (!rootPackageJsonPath) {
    throw new Error('No package.json found in current directory');
  }

  const rootPackageJson = await readPackageJson(rootPackageJsonPath);
  const workspacePatterns = getWorkspacePatterns(rootPackageJson);

  let packageDirs: string[] = [];

  // Check if the root package itself is publishable (not private, has a name)
  const rootIsPublishable =
    !rootPackageJson.private && rootPackageJson.name && rootPackageJson.version;

  if (workspacePatterns.length > 0) {
    // Use workspace patterns from package.json
    for (const pattern of workspacePatterns) {
      const matches = await glob(pattern, cwd);
      packageDirs.push(...matches);
    }
  } else {
    // Fallback: look for packages/ directory
    const packagesDir = join(cwd, 'packages');
    try {
      const entries = await readdir(packagesDir, { withFileTypes: true });
      packageDirs = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => join('packages', entry.name));
    } catch {
      // No packages directory, treat root as single package
      if (!rootPackageJson.private) {
        return [
          await packageFromPath(cwd, rootPackageJsonPath, rootPackageJson, []),
        ];
      }
      return [];
    }
  }

  // Read all package.json files
  const packages: DiscoveredPackage[] = [];
  const packageNames = new Set<string>();

  // Include the root package if it's publishable
  if (rootIsPublishable) {
    packageNames.add(rootPackageJson.name);
    packages.push(
      await packageFromPath(cwd, rootPackageJsonPath, rootPackageJson, []),
    );
  }

  for (const dir of packageDirs) {
    const pkgPath = resolve(cwd, dir);
    const pkgJsonPath = join(pkgPath, 'package.json');

    try {
      const pkgJson = await readPackageJson(pkgJsonPath);
      packageNames.add(pkgJson.name);
      packages.push(await packageFromPath(pkgPath, pkgJsonPath, pkgJson, []));
    } catch {
      // Skip directories without package.json
    }
  }

  // Resolve local dependencies
  for (const pkg of packages) {
    pkg.localDependencies = findLocalDependencies(pkg, packageNames);
  }

  return packages;
}

async function packageFromPath(
  path: string,
  packageJsonPath: string,
  packageJson: PackageJson,
  localDependencies: string[],
): Promise<DiscoveredPackage> {
  return {
    name: packageJson.name,
    version: packageJson.version,
    path,
    packageJsonPath,
    isPrivate: packageJson.private === true,
    localDependencies,
  };
}

function findLocalDependencies(
  pkg: DiscoveredPackage,
  packageNames: Set<string>,
): string[] {
  const deps: string[] = [];

  // We need to re-read the package.json to get dependencies
  // This is a sync operation for simplicity
  const pkgJson = JSON.parse(
    require('node:fs').readFileSync(pkg.packageJsonPath, 'utf-8'),
  ) as PackageJson;

  const allDeps = {
    ...pkgJson.dependencies,
    ...pkgJson.devDependencies,
    ...pkgJson.peerDependencies,
  };

  for (const depName of Object.keys(allDeps)) {
    if (packageNames.has(depName)) {
      deps.push(depName);
    }
  }

  return deps;
}

export function sortByDependencyOrder(
  packages: DiscoveredPackage[],
): DiscoveredPackage[] {
  const packageMap = new Map(packages.map((p) => [p.name, p]));
  const sorted: DiscoveredPackage[] = [];
  const visited = new Set<string>();

  function visit(pkg: DiscoveredPackage) {
    if (visited.has(pkg.name)) return;
    visited.add(pkg.name);

    // Visit dependencies first
    for (const depName of pkg.localDependencies) {
      const dep = packageMap.get(depName);
      if (dep) {
        visit(dep);
      }
    }

    sorted.push(pkg);
  }

  for (const pkg of packages) {
    visit(pkg);
  }

  return sorted;
}
