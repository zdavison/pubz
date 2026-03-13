let verboseEnabled = false;

export function setVerbose(enabled: boolean): void {
  verboseEnabled = enabled;
}

export function debug(...args: unknown[]): void {
  if (verboseEnabled) {
    console.error('[debug]', ...args);
  }
}
