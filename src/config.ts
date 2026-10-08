import { ConfigurationError, UsageError } from "./errors.js";

export const DEFAULT_AUTH_ARTIFACTS = ["auth.json", "config.toml"] as const;
export const DETAIL_LEVELS = ["verbose", "internal", "turns", "end"] as const;
export const DEFAULT_CODEX_IMAGE = "authy-codex:local";
export type DetailLevel = (typeof DETAIL_LEVELS)[number];

export interface AuthyConfig {
  codexImage: string;
  authVolumeName: string;
  codexVolumeName: string;
  storageDirectory: string;
  authArtifacts: readonly string[];
  maxArtifactBytes: number;
  defaultTimeoutMs: number;
  queueWindowMs: number;
  leaseMs: number;
  statusCacheTtlMs: number;
  maxListTake: number;
  networkMode?: string;
}

export const defaultConfig = (): AuthyConfig => ({
  // A digest is required so deployments cannot silently drift to a different image.
  codexImage: DEFAULT_CODEX_IMAGE,
  authVolumeName: "authy-auth",
  codexVolumeName: "authy-codex",
  storageDirectory: ".authy",
  authArtifacts: DEFAULT_AUTH_ARTIFACTS,
  maxArtifactBytes: 1024 * 1024,
  defaultTimeoutMs: 10 * 60_000,
  queueWindowMs: 60_000,
  leaseMs: 30_000,
  statusCacheTtlMs: 60_000,
  maxListTake: 100,
  networkMode: "bridge"
});

export function validateConfig(input: Partial<AuthyConfig> = {}): AuthyConfig {
  const config = { ...defaultConfig(), ...input };
  if (config.codexImage !== DEFAULT_CODEX_IMAGE && !config.codexImage.includes("@sha256:")) {
    throw new ConfigurationError(
      "codexImage must be the built-in authy-codex:local image or be pinned by a sha256 digest."
    );
  }
  for (const [name, value] of Object.entries({
    authVolumeName: config.authVolumeName,
    codexVolumeName: config.codexVolumeName,
    storageDirectory: config.storageDirectory
  })) {
    if (!value || value.trim().length === 0) throw new ConfigurationError(`${name} must be configured.`);
  }
  if (!Number.isSafeInteger(config.maxArtifactBytes) || config.maxArtifactBytes < 1) {
    throw new ConfigurationError("maxArtifactBytes must be a positive integer.");
  }
  for (const [name, value] of Object.entries({ defaultTimeoutMs: config.defaultTimeoutMs, queueWindowMs: config.queueWindowMs, leaseMs: config.leaseMs, statusCacheTtlMs: config.statusCacheTtlMs, maxListTake: config.maxListTake })) {
    if (!Number.isSafeInteger(value) || value < 0) throw new ConfigurationError(`${name} must be a non-negative integer.`);
  }
  if (!config.authArtifacts.length || config.authArtifacts.some((name) => !isSafeArtifactName(name))) {
    throw new ConfigurationError("authArtifacts must contain safe file names.");
  }
  return config;
}

export function validateAccountId(accountId: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(accountId)) {
    throw new UsageError("accountId must contain only letters, numbers, underscores, or hyphens.");
  }
  return accountId;
}

export function validateDetailLevel(value: string): DetailLevel {
  if (!(DETAIL_LEVELS as readonly string[]).includes(value)) {
    throw new UsageError(`detailLevel must be one of: ${DETAIL_LEVELS.join(", ")}.`);
  }
  return value as DetailLevel;
}

export function isSafeArtifactName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(name) && !name.includes("..");
}
