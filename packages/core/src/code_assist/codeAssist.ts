/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * 注意：此模块已不再使用，当前仅支持 OpenAI 兼容端点认证
 * 保留此文件仅为兼容性考虑
 */

import { type ContentGenerator } from '../core/contentGenerator.js';
import type { Config } from '../config/config.js';

export async function createCodeAssistContentGenerator(
  _httpOptions: unknown,
  _authType: string,
  _config: Config,
  _sessionId?: string,
): Promise<ContentGenerator> {
  throw new Error('Code Assist 认证方式已不再支持，当前仅支持 OpenAI 兼容端点');
}

export function getCodeAssistServer(_config: Config): undefined {
  return undefined;
}
