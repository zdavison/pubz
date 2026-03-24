export interface PackageJson {
  name: string;
  version: string;
  private?: boolean;
  workspaces?: string[] | { packages: string[] };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

export interface DiscoveredPackage {
  name: string;
  version: string;
  path: string;
  packageJsonPath: string;
  isPrivate: boolean;
  localDependencies: string[];
}

export interface PublishOptions {
  dryRun: boolean;
  registry: string;
  otp: string;
  skipBuild: boolean;
  skipPublish: boolean;
  skipConfirms: boolean;
  ci: boolean;
  version: string;
  verbose: boolean;
}

export type VersionBumpType = 'major' | 'minor' | 'patch' | 'none';
