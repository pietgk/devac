// src/devac/cli/config.ts

import fs from 'fs/promises';
import path from 'path';
import { createContextLogger } from '../../utils/logger.js';
import type { DevACConfig } from '../types/config.js';
import { DEFAULT_DEVAC_CONFIG } from '../types/config.js';

const logger = createContextLogger('Config');

/**
 * Load DevAC configuration from file
 */
export async function loadDevACConfig(configPath: string): Promise<DevACConfig> {
  try {
    logger.debug(`Loading configuration from: ${configPath}`);

    const absolutePath = path.resolve(configPath);
    const configData = await fs.readFile(absolutePath, 'utf-8');
    const config = JSON.parse(configData) as DevACConfig;

    logger.info('Configuration loaded successfully');

    return config;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      logger.warn(`Configuration file not found: ${configPath}`);
      logger.info('Using default configuration');
      return DEFAULT_DEVAC_CONFIG;
    }

    logger.error(`Failed to load configuration: ${error.message}`);
    throw error;
  }
}

/**
 * Save DevAC configuration to file
 */
export async function saveDevACConfig(
  configPath: string,
  config: DevACConfig
): Promise<void> {
  try {
    logger.debug(`Saving configuration to: ${configPath}`);

    const absolutePath = path.resolve(configPath);

    // Ensure directory exists
    const dir = path.dirname(absolutePath);
    await fs.mkdir(dir, { recursive: true });

    // Write config
    await fs.writeFile(
      absolutePath,
      JSON.stringify(config, null, 2),
      'utf-8'
    );

    logger.info('Configuration saved successfully');
  } catch (error: any) {
    logger.error(`Failed to save configuration: ${error.message}`);
    throw error;
  }
}

/**
 * Validate DevAC configuration
 */
export function validateDevACConfig(config: any): config is DevACConfig {
  // Basic validation
  if (!config || typeof config !== 'object') {
    return false;
  }

  if (!config.version || typeof config.version !== 'string') {
    return false;
  }

  if (!config.neo4j || typeof config.neo4j !== 'object') {
    return false;
  }

  if (!config.web || typeof config.web !== 'object') {
    return false;
  }

  if (!config.services || typeof config.services !== 'object') {
    return false;
  }

  if (!config.logging || typeof config.logging !== 'object') {
    return false;
  }

  return true;
}
