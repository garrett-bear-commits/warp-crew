// @foundation/tooling — pure functions behind the `foundation` CLI (tests import from here).
export { parseArgs, UsageError, type ParsedArgs, type Io } from './args.ts';
export {
  planRelease,
  rewriteIndexHtml,
  deployStatic,
  verifyRelease,
  readManifest,
  hashDir,
  sha256Hex,
  sha256File,
  readContractVersion,
  HEADERS_POLICY,
  type ReleaseManifest,
  type ReleaseInput,
  type DeployResult,
} from './deploy.ts';
export {
  writeZip,
  readZipDirectory,
  readZipEntry,
  zipDirectory,
  type ZipEntry,
  type ZipListing,
} from './zip.ts';
export {
  parseEnvFile,
  preflightEnv,
  parseAdminKeysShape,
  formatChecklist,
  type PreflightResult,
  type EnvCheck,
} from './preflight.ts';
export {
  parseManifest,
  validateManifestAgainst,
  makeManifest,
  type BackupManifest,
  type Destination,
  type ManifestVerdict,
} from './manifest.ts';
export {
  measureBundle,
  checkBundleSize,
  runBundleSizeMain,
  type BundleReport,
  type BundleFile,
} from './bundle-size.ts';
export { checkHealth, type HealthOptions, type HealthOutcome } from './health.ts';
export { validateFleet, loadFleet, type FleetEntry, type FleetFile } from './fleet.ts';
export {
  scaffoldGameServer,
  scaffoldFeature,
  featureSources,
  renameTemplateSource,
  clientChecklist,
  camelCase,
  pascalCase,
  type NewServerResult,
  type NewFeatureResult,
} from './scaffold.ts';
export { main as cliMain, COMMANDS, usageLines } from './cli.ts';
