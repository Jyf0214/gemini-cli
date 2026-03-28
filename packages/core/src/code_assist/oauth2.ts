/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type AuthClient } from 'google-auth-library';
import * as net from 'node:net';
import { promises as fs } from 'node:fs';
import type { Config } from '../config/config.js';
import { UserAccountManager } from '../utils/userAccountManager.js';
import type { AuthType } from '../core/contentGenerator.js';
import { Storage } from '../config/storage.js';
import { OAuthCredentialStorage } from './oauth-credential-storage.js';
import { FORCE_ENCRYPTED_FILE_ENV_VAR } from '../mcp/token-storage/index.js';
import { debugLogger } from '../utils/debugLogger.js';

const userAccountManager = new UserAccountManager();

const oauthClientPromises = new Map<AuthType, Promise<AuthClient>>();

function getUseEncryptedStorageFlag() {
  return process.env[FORCE_ENCRYPTED_FILE_ENV_VAR] === 'true';
}

export async function getOauthClient(
  _authType: AuthType,
  _config: Config,
): Promise<AuthClient> {
  throw new Error(
    'OAuth2 认证不再支持。当前仅支持 OpenAI 兼容端点认证方式。' +
      '请使用 API Key 或其他兼容的认证方式。',
  );
}

export function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    let port = 0;
    try {
      const portStr = process.env['OAUTH_CALLBACK_PORT'];
      if (portStr) {
        port = parseInt(portStr, 10);
        if (isNaN(port) || port <= 0 || port > 65535) {
          return reject(
            new Error(`Invalid value for OAUTH_CALLBACK_PORT: "${portStr}"`),
          );
        }
        return resolve(port);
      }
      const server = net.createServer();
      server.listen(0, () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          port = address.port;
        }
      });
      server.on('listening', () => {
        server.close();
        server.unref();
      });
      server.on('error', (e) => reject(e));
      server.on('close', () => resolve(port));
    } catch (e) {
      reject(e);
    }
  });
}

export function clearOauthClientCache() {
  oauthClientPromises.clear();
}

export async function clearCachedCredentialFile() {
  try {
    const useEncryptedStorage = getUseEncryptedStorageFlag();
    if (useEncryptedStorage) {
      await OAuthCredentialStorage.clearCredentials();
    } else {
      await fs.rm(Storage.getOAuthCredsPath(), { force: true });
    }
    // Clear the Google Account ID cache when credentials are cleared
    await userAccountManager.clearCachedGoogleAccount();
    // Clear the in-memory OAuth client cache to force re-authentication
    clearOauthClientCache();
  } catch (e) {
    debugLogger.warn('Failed to clear cached credentials:', e);
  }
}

// Helper to ensure test isolation
export function resetOauthClientForTesting() {
  oauthClientPromises.clear();
}
