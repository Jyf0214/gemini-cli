/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { isApiError, isStructuredError } from './quotaErrorDetection.js';
import { DEFAULT_GEMINI_FLASH_MODEL } from '../config/models.js';
import type { UserTierId } from '../code_assist/types.js';
import { AuthType } from '../core/contentGenerator.js';

// 注意：当前仅支持 OpenAI 兼容端点认证
const RATE_LIMIT_ERROR_MESSAGE_OPENAI_COMPATIBLE =
  '\n请稍后再试。如需增加限制，请通过 API 提供商请求配额增加，或切换到其他 /auth 方法';
const getRateLimitErrorMessageDefault = (
  fallbackModel: string = DEFAULT_GEMINI_FLASH_MODEL,
) =>
  `\n可能存在配额限制或检测到响应时间过慢。在本次会话的剩余时间里，将切换到 ${fallbackModel} 模型。`;

/**
 * 获取速率限制错误消息
 * 注意：当前仅支持 OpenAI 兼容端点认证
 */
function getRateLimitMessage(
  authType?: AuthType,
  fallbackModel?: string,
): string {
  switch (authType) {
    case AuthType.OPENAI_COMPATIBLE:
      return RATE_LIMIT_ERROR_MESSAGE_OPENAI_COMPATIBLE;
    default:
      return getRateLimitErrorMessageDefault(fallbackModel);
  }
}

export function parseAndFormatApiError(
  error: unknown,
  authType?: AuthType,
  userTier?: UserTierId,
  currentModel?: string,
  fallbackModel?: string,
): string {
  if (isStructuredError(error)) {
    let text = `[API Error: ${error.message}]`;
    if (error.status === 429) {
      text += getRateLimitMessage(authType, fallbackModel);
    }
    return text;
  }

  // The error message might be a string containing a JSON object.
  if (typeof error === 'string') {
    const jsonStart = error.indexOf('{');
    if (jsonStart === -1) {
      return `[API Error: ${error}]`; // Not a JSON error, return as is.
    }

    const jsonString = error.substring(jsonStart);

    try {
      const parsedError = JSON.parse(jsonString) as unknown;
      if (isApiError(parsedError)) {
        let finalMessage = parsedError.error.message;
        try {
          // See if the message is a stringified JSON with another error
          const nestedError = JSON.parse(finalMessage) as unknown;
          if (isApiError(nestedError)) {
            finalMessage = nestedError.error.message;
          }
        } catch (_e) {
          // It's not a nested JSON error, so we just use the message as is.
        }
        let text = `[API Error: ${finalMessage} (Status: ${parsedError.error.status})]`;
        if (parsedError.error.code === 429) {
          text += getRateLimitMessage(authType, fallbackModel);
        }
        return text;
      }
    } catch (_e) {
      // Not a valid JSON, fall through and return the original message.
    }
    return `[API Error: ${error}]`;
  }

  return '[API Error: An unknown error occurred.]';
}
