/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  type CountTokensResponse,
  type GenerateContentResponse,
  type GenerateContentParameters,
  type CountTokensParameters,
  type EmbedContentResponse,
  type EmbedContentParameters,
} from '@google/genai';
import type { Config } from '../config/config.js';

import type { UserTierId, GeminiUserTier } from '../code_assist/types.js';
import { LoggingContentGenerator } from './loggingContentGenerator.js';
import { FakeContentGenerator } from './fakeContentGenerator.js';

import { RecordingContentGenerator } from './recordingContentGenerator.js';
import type { LlmRole } from '../telemetry/llmRole.js';

/**
 * 内容生成器接口，抽象核心功能
 */
export interface ContentGenerator {
  generateContent(
    request: GenerateContentParameters,
    userPromptId: string,
    role: LlmRole,
  ): Promise<GenerateContentResponse>;

  generateContentStream(
    request: GenerateContentParameters,
    userPromptId: string,
    role: LlmRole,
  ): Promise<AsyncGenerator<GenerateContentResponse>>;

  countTokens(request: CountTokensParameters): Promise<CountTokensResponse>;

  embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse>;

  userTier?: UserTierId;

  userTierName?: string;

  paidTier?: GeminiUserTier;
}

/**
 * 认证类型枚举 - 当前仅支持 OpenAI 兼容端点
 */
export enum AuthType {
  OPENAI_COMPATIBLE = 'openai-compatible',
}

/**
 * 检测环境变量中的认证类型
 * 当前仅支持 OpenAI 兼容端点，此函数始终返回 undefined
 */
export function getAuthTypeFromEnv(): AuthType | undefined {
  return undefined;
}

export type ContentGeneratorConfig = {
  apiKey?: string;
  vertexai?: boolean;
  authType?: AuthType;
  proxy?: string;
  baseUrl?: string;
  customHeaders?: Record<string, string>;
};

/**
 * 创建内容生成器配置
 * 当前仅支持 OpenAI 兼容端点
 */
export async function createContentGeneratorConfig(
  config: Config,
  authType: AuthType | undefined,
  apiKey?: string,
  baseUrl?: string,
  customHeaders?: Record<string, string>,
): Promise<ContentGeneratorConfig> {
  const contentGeneratorConfig: ContentGeneratorConfig = {
    authType,
    proxy: config?.getProxy(),
    baseUrl,
    customHeaders,
  };

  if (authType === AuthType.OPENAI_COMPATIBLE) {
    contentGeneratorConfig.apiKey = apiKey;
    contentGeneratorConfig.vertexai = false;
    contentGeneratorConfig.baseUrl = baseUrl;

    return contentGeneratorConfig;
  }

  return contentGeneratorConfig;
}

/**
 * 创建内容生成器
 * 当前仅支持 OpenAI 兼容端点
 */
export async function createContentGenerator(
  config: ContentGeneratorConfig,
  gcConfig: Config,
  _sessionId?: string,
): Promise<ContentGenerator> {
  const generator = await (async () => {
    if (gcConfig.fakeResponses) {
      const fakeGenerator = await FakeContentGenerator.fromFile(
        gcConfig.fakeResponses,
      );
      return new LoggingContentGenerator(fakeGenerator, gcConfig);
    }

    if (config.authType === AuthType.OPENAI_COMPATIBLE) {
      const { OpenAIContentGenerator } = await import(
        './openaiContentGenerator.js'
      );
      const openaiGenerator = new OpenAIContentGenerator(
        config.apiKey || '',
        config.baseUrl || '',
      );
      return new LoggingContentGenerator(openaiGenerator, gcConfig);
    }

    throw new Error(`创建内容生成器失败：不支持的认证类型: ${config.authType}`);
  })();

  if (gcConfig.recordResponses) {
    return new RecordingContentGenerator(generator, gcConfig.recordResponses);
  }

  return generator;
}
