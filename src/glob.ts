import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export async function glob(pattern: string, cwd: string): Promise<string[]> {
  // Simple glob implementation for workspace patterns
  // Supports: packages/*, packages/**, src/*
  const results: string[] = [];

  // Check if pattern is an exact directory (no glob suffix)
  const isGlob = /\/\*\*?$/.test(pattern);

  // Remove trailing /* or /**
  const basePattern = pattern.replace(/\/\*\*?$/, '');
  const isRecursive = pattern.endsWith('/**');

  const basePath = join(cwd, basePattern);

  // Exact directory reference (e.g. "srb") — check if it has a package.json directly
  if (!isGlob) {
    try {
      await stat(join(basePath, 'package.json'));
      return [basePattern];
    } catch {
      // No package.json at this path, fall through to subdirectory scan
    }
  }

  try {
    const entries = await readdir(basePath, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const entryPath = join(basePattern, entry.name);
        const fullPath = join(cwd, entryPath);

        // Check if this directory has a package.json
        try {
          await stat(join(fullPath, 'package.json'));
          results.push(entryPath);
        } catch {
          // No package.json, skip unless recursive
          if (isRecursive) {
            const subResults = await glob(`${entryPath}/*`, cwd);
            results.push(...subResults);
          }
        }
      }
    }
  } catch {
    // Directory doesn't exist
  }

  return results;
}
