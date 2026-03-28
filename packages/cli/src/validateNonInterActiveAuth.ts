/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  debugLogger,
  OutputFormat,
  ExitCodes,
  getAuthTypeFromEnv,
  type Config,
  type AuthType,
} from '@google/gemini-cli-core';
import { USER_SETTINGS_PATH, type LoadedSettings } from './config/settings.js';
import { validateAuthMethod } from './config/auth.js';
import { handleError } from './utils/errors.js';
import { runExitCleanup } from './utils/cleanup.js';

export async function validateNonInteractiveAuth(
  configuredAuthType: AuthType | undefined,
  useExternalAuth: boolean | undefined,
  nonInteractiveConfig: Config,
  settings: LoadedSettings,
) {
  try {
    // 获取认证类型
    const effectiveAuthType = configuredAuthType || getAuthTypeFromEnv();

    // 检查认证类型是否符合强制要求
    const enforcedType = settings.merged.security.auth.enforcedType;
    if (enforcedType && effectiveAuthType !== enforcedType) {
      const message = effectiveAuthType
        ? `强制认证类型为 '${enforcedType}'，但当前类型为 '${effectiveAuthType}'。请使用正确的类型重新认证。`
        : `强制要求认证类型 '${enforcedType}'，但未配置认证。`;
      throw new Error(message);
    }

    // 检查是否配置了认证方式
    if (!effectiveAuthType) {
      const message = `请在 ${USER_SETTINGS_PATH} 中设置认证方式，当前仅支持配置 OpenAI 兼容端点进行认证。`;
      throw new Error(message);
    }

    const authType: AuthType = effectiveAuthType;

    // 验证认证方式（非外部认证时）
    if (!useExternalAuth) {
      const err = validateAuthMethod(String(authType));
      if (err != null) {
        throw new Error(err);
      }
    }

    return authType;
  } catch (error) {
    if (nonInteractiveConfig.getOutputFormat() === OutputFormat.JSON) {
      handleError(
        error instanceof Error ? error : new Error(String(error)),
        nonInteractiveConfig,
        ExitCodes.FATAL_AUTHENTICATION_ERROR,
      );
    } else {
      debugLogger.error(error instanceof Error ? error.message : String(error));
      await runExitCleanup();
      process.exit(ExitCodes.FATAL_AUTHENTICATION_ERROR);
    }
  }
}
