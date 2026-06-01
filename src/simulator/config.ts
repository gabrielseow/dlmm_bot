// Configuration loader/validator for the simulator (FR-014, contracts/simulator-cli.md).
// All operational parameters come from environment variables with documented
// defaults; config.ts is the single source of truth and validates everything
// BEFORE any I/O. Invalid configuration throws ConfigError, which the CLI maps
// to exit code 2 (fail-closed, mirroring Part 1's screener).

import { DEFAULT_METEORA_BASE_URL } from '../meteora.js';
import {
  LIQUIDITY_SOURCES,
  NETWORKS,
  SHAPES,
  TIMEFRAMES,
  type LiquiditySource,
  type Network,
  type Shape,
  type SimulationConfig,
  type TimeFrame,
} from './types.js';

/** Thrown on invalid configuration. The CLI maps this to exit code 2. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

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

function parsePositiveNumberOrNull(name: string, raw: string | undefined): number | null {
  if (isBlank(raw)) return null;
  const value = Number(raw.trim());
  if (!Number.isFinite(value)) {
    throw new ConfigError(`Invalid ${name}: "${raw.trim()}" is not a finite number.`);
  }
  if (!(value > 0)) {
    throw new ConfigError(`Invalid ${name}: ${value} must be > 0.`);
  }
  return value;
}

function parseIntOrNull(name: string, raw: string | undefined): number | null {
  if (isBlank(raw)) return null;
  const value = Number(raw.trim());
  if (!Number.isInteger(value)) {
    throw new ConfigError(`Invalid ${name}: "${raw.trim()}" must be an integer.`);
  }
  return value;
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

/**
 * Build a validated SimulationConfig from environment variables. Throws
 * ConfigError on any invalid value (mapped to CLI exit code 2). Validation runs
 * fully before any network call.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): SimulationConfig {
  // --- pool (required) ---
  if (isBlank(env.SIM_POOL)) {
    throw new ConfigError('SIM_POOL is required (the base58 pool address to simulate).');
  }
  const pool = env.SIM_POOL.trim();

  // --- deposit: exactly one form, all amounts > 0 ---
  const depositX = parsePositiveNumberOrNull('SIM_DEPOSIT_X', env.SIM_DEPOSIT_X);
  const depositY = parsePositiveNumberOrNull('SIM_DEPOSIT_Y', env.SIM_DEPOSIT_Y);
  const depositUsd = parsePositiveNumberOrNull('SIM_DEPOSIT_USD', env.SIM_DEPOSIT_USD);
  const hasTokenForm = depositX !== null || depositY !== null;
  const hasUsdForm = depositUsd !== null;
  if (!hasTokenForm && !hasUsdForm) {
    throw new ConfigError(
      'A deposit is required: supply SIM_DEPOSIT_USD, or SIM_DEPOSIT_X and/or SIM_DEPOSIT_Y (all > 0).',
    );
  }
  if (hasTokenForm && hasUsdForm) {
    throw new ConfigError(
      'Supply exactly one deposit form: either SIM_DEPOSIT_USD or SIM_DEPOSIT_X/SIM_DEPOSIT_Y, not both.',
    );
  }

  // --- range: price range OR bin range; bin range overrides ---
  const rangeLower = parsePositiveNumberOrNull('SIM_RANGE_LOWER', env.SIM_RANGE_LOWER);
  const rangeUpper = parsePositiveNumberOrNull('SIM_RANGE_UPPER', env.SIM_RANGE_UPPER);
  const binLower = parseIntOrNull('SIM_BIN_LOWER', env.SIM_BIN_LOWER);
  const binUpper = parseIntOrNull('SIM_BIN_UPPER', env.SIM_BIN_UPPER);

  const hasBinRange = binLower !== null || binUpper !== null;
  const hasPriceRange = rangeLower !== null || rangeUpper !== null;

  if (hasBinRange) {
    if (binLower === null || binUpper === null) {
      throw new ConfigError('A bin range requires both SIM_BIN_LOWER and SIM_BIN_UPPER.');
    }
    if (binLower > binUpper) {
      throw new ConfigError(
        `Invalid bin range: SIM_BIN_LOWER (${binLower}) must be <= SIM_BIN_UPPER (${binUpper}).`,
      );
    }
  } else if (hasPriceRange) {
    if (rangeLower === null || rangeUpper === null) {
      throw new ConfigError(
        'A price range requires both SIM_RANGE_LOWER and SIM_RANGE_UPPER.',
      );
    }
    if (!(rangeLower < rangeUpper)) {
      throw new ConfigError(
        `Invalid price range: SIM_RANGE_LOWER (${rangeLower}) must be < SIM_RANGE_UPPER (${rangeUpper}).`,
      );
    }
  } else {
    throw new ConfigError(
      'A range is required: supply SIM_RANGE_LOWER/SIM_RANGE_UPPER (prices) or SIM_BIN_LOWER/SIM_BIN_UPPER (bin ids).',
    );
  }

  const shape: Shape = parseEnum('SIM_SHAPE', env.SIM_SHAPE, SHAPES, 'spot');
  const timeframe: TimeFrame = parseEnum('SIM_TIMEFRAME', env.SIM_TIMEFRAME, TIMEFRAMES, '1h');

  // --- window ---
  const start = parseIntOrNull('SIM_START', env.SIM_START);
  const end = parseIntOrNull('SIM_END', env.SIM_END);
  if (start !== null && end !== null && !(start < end)) {
    throw new ConfigError(`Invalid window: SIM_START (${start}) must be < SIM_END (${end}).`);
  }

  const liquiditySource: LiquiditySource = parseEnum(
    'SIM_LIQUIDITY_SOURCE',
    env.SIM_LIQUIDITY_SOURCE,
    LIQUIDITY_SOURCES,
    'aggregated',
  );

  const tolerance = parseNonNegativeNumber('SIM_TOLERANCE', env.SIM_TOLERANCE, 0.1);

  const network: Network = parseEnum('SIM_NETWORK', env.SIM_NETWORK, NETWORKS, 'mainnet');

  const rpcUrl = isBlank(env.SIM_RPC_URL) ? null : env.SIM_RPC_URL.trim();
  if (liquiditySource === 'snapshot' && rpcUrl === null) {
    throw new ConfigError(
      'SIM_LIQUIDITY_SOURCE=snapshot requires SIM_RPC_URL (a Solana RPC endpoint for the on-chain bin snapshot).',
    );
  }

  // --- verification ---
  const verifyUser = isBlank(env.SIM_VERIFY_USER) ? null : env.SIM_VERIFY_USER.trim();
  const verifyPosition = isBlank(env.SIM_VERIFY_POSITION)
    ? null
    : env.SIM_VERIFY_POSITION.trim();
  if (verifyPosition !== null && verifyUser === null) {
    throw new ConfigError('SIM_VERIFY_POSITION requires SIM_VERIFY_USER.');
  }

  const baseUrl = isBlank(env.METEORA_BASE_URL)
    ? DEFAULT_METEORA_BASE_URL
    : env.METEORA_BASE_URL.trim();
  const output = isBlank(env.SIM_OUTPUT) ? null : env.SIM_OUTPUT.trim();

  return {
    pool,
    depositX,
    depositY,
    depositUsd,
    rangeLower: hasBinRange ? null : rangeLower,
    rangeUpper: hasBinRange ? null : rangeUpper,
    binLower,
    binUpper,
    shape,
    timeframe,
    start,
    end,
    liquiditySource,
    tolerance,
    verifyUser,
    verifyPosition,
    baseUrl,
    rpcUrl,
    network,
    output,
  };
}
