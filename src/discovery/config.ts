// Configuration loader/validator for the screener (FR-011, contracts/screener-cli.md).
// All operational parameters come from environment variables with documented
// defaults. Invalid configuration (unknown enum, negative threshold, malformed
// number) throws a ConfigError so the CLI can fail-closed with exit code 2
// BEFORE any network call.

import { DEFAULT_METEORA_BASE_URL } from '../meteora.js';
import {
  INDICATORS,
  MEASUREMENT_WINDOWS,
  NETWORKS,
  type ScreeningCriteria,
} from './types.js';

/** Thrown on invalid configuration. The CLI maps this to exit code 2. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const SORT_DIRECTIONS = ['desc', 'asc'] as const;

function isBlank(raw: string | undefined): raw is undefined {
  return raw === undefined || raw.trim() === '';
}

function parseEnum<T extends string>(
  name: string,
  raw: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (isBlank(raw)) return fallback;
  const value = raw.trim();
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new ConfigError(
    `Invalid ${name}: "${value}". Allowed values: ${allowed.join(', ')}.`,
  );
}

function parseNonNegativeNumber(
  name: string,
  raw: string | undefined,
  fallback: number,
): number {
  if (isBlank(raw)) return fallback;
  const value = Number(raw.trim());
  if (!Number.isFinite(value)) {
    throw new ConfigError(`Invalid ${name}: "${raw.trim()}" is not a finite number.`);
  }
  if (value < 0) {
    throw new ConfigError(`Invalid ${name}: ${value} must be >= 0.`);
  }
  return value;
}

function parsePositiveInt(
  name: string,
  raw: string | undefined,
  fallback: number,
): number {
  if (isBlank(raw)) return fallback;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 1) {
    throw new ConfigError(`Invalid ${name}: "${raw.trim()}" must be an integer >= 1.`);
  }
  return value;
}

function parsePositiveIntOrNull(name: string, raw: string | undefined): number | null {
  if (isBlank(raw)) return null;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 1) {
    throw new ConfigError(`Invalid ${name}: "${raw.trim()}" must be an integer >= 1.`);
  }
  return value;
}

/**
 * Build a validated ScreeningCriteria from environment variables. Throws
 * ConfigError on any invalid value (mapped to CLI exit code 2).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ScreeningCriteria {
  const window = parseEnum('SCREEN_WINDOW', env.SCREEN_WINDOW, MEASUREMENT_WINDOWS, '24h');
  const indicator = parseEnum(
    'SCREEN_INDICATOR',
    env.SCREEN_INDICATOR,
    INDICATORS,
    'fee_to_tvl',
  );
  const network = parseEnum('SCREEN_NETWORK', env.SCREEN_NETWORK, NETWORKS, 'mainnet');
  const sortDirection = parseEnum(
    'SCREEN_SORT',
    env.SCREEN_SORT,
    SORT_DIRECTIONS,
    'desc',
  );
  const minTvl = parseNonNegativeNumber('SCREEN_MIN_TVL', env.SCREEN_MIN_TVL, 0);
  const minVolume = parseNonNegativeNumber('SCREEN_MIN_VOLUME', env.SCREEN_MIN_VOLUME, 0);
  const topN = parsePositiveIntOrNull('SCREEN_TOP_N', env.SCREEN_TOP_N);
  const newPoolMaxAgeSec = parsePositiveInt(
    'SCREEN_NEW_POOL_MAX_AGE_SEC',
    env.SCREEN_NEW_POOL_MAX_AGE_SEC,
    86_400,
  );
  const baseUrl = isBlank(env.METEORA_BASE_URL)
    ? DEFAULT_METEORA_BASE_URL
    : env.METEORA_BASE_URL.trim();
  const output = isBlank(env.SCREEN_OUTPUT) ? null : env.SCREEN_OUTPUT.trim();

  return {
    window,
    indicator,
    minTvl,
    minVolume,
    topN,
    sortDirection,
    network,
    baseUrl,
    output,
    newPoolMaxAgeSec,
  };
}
