import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { debug } from './log.js';

const CONFIG_FILENAME = '.pubz';

/**
 * Config values that can be set in a `.pubz` file.
 * Uses kebab-case keys matching CLI flag names (without the `--` prefix).
 */
export interface PubzConfig {
  'skip-build'?: boolean;
  'skip-publish'?: boolean;
  registry?: string;
}

/** All keys that are valid in a `.pubz` config file. */
const VALID_KEYS = new Set<string>(['skip-build', 'skip-publish', 'registry']);

/**
 * Load and parse a `.pubz` config file from the given directory.
 * Returns an empty object if the file doesn't exist.
 *
 * Format is simple key=value, one per line. Boolean flags can omit the value
 * (presence means `true`), or use explicit `true`/`false`.
 *
 * Lines starting with `#` are comments. Blank lines are ignored.
 *
 * @example
 * ```
 * # .pubz
 * skip-publish
 * registry=https://npm.pkg.github.com
 * ```
 */
export function loadConfig(cwd: string): PubzConfig {
  const configPath = join(cwd, CONFIG_FILENAME);

  if (!existsSync(configPath)) {
    debug(`No ${CONFIG_FILENAME} found at ${configPath}`);
    return {};
  }

  const content = readFileSync(configPath, 'utf-8');
  const config: PubzConfig = {};

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();

    if (!line || line.startsWith('#')) continue;

    const eqIndex = line.indexOf('=');

    let key: string;
    let value: string | undefined;

    if (eqIndex === -1) {
      key = line;
    } else {
      key = line.slice(0, eqIndex).trim();
      value = line.slice(eqIndex + 1).trim();
    }

    if (!VALID_KEYS.has(key)) {
      debug(`Ignoring unknown config key: ${key}`);
      continue;
    }

    if (key === 'registry') {
      config.registry = value ?? '';
    } else {
      // Boolean flags: bare key or explicit true/false
      const boolKey = key as 'skip-build' | 'skip-publish';
      if (value === undefined || value === 'true') {
        config[boolKey] = true;
      } else if (value === 'false') {
        config[boolKey] = false;
      } else {
        debug(`Invalid boolean value for ${key}: ${value}`);
      }
    }
  }

  debug(`Loaded ${CONFIG_FILENAME}: ${JSON.stringify(config)}`);
  return config;
}
