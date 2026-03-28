/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AuthType } from '@google/gemini-cli-core';
import { loadEnvironment, loadSettings } from './settings.js';

export function validateAuthMethod(authMethod: string): string | null {
  loadEnvironment(loadSettings().merged, process.cwd());

  // 仅支持 OpenAI 兼容端点认证方式
  if (authMethod === AuthType.OPENAI_COMPATIBLE) {
    const settings = loadSettings().merged;
    const endpoint = settings.security?.auth?.openaiEndpoint;
    if (!endpoint) {
      return (
        '使用 OpenAI 兼容 API 时，必须配置端点 URL。\n' +
        '请重新运行认证流程以提供端点、API 密钥和模型。'
      );
    }
    return null;
  }

  // 其他认证方式不支持，返回错误提示
  return '当前仅支持 OpenAI 兼容端点认证方式。请选择 OpenAI Compatible 作为认证方法。';
}
