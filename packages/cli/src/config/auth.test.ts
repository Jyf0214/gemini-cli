/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { AuthType } from '@google/gemini-cli-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateAuthMethod } from './auth.js';

vi.mock('./settings.js', () => ({
  loadEnvironment: vi.fn(),
  loadSettings: vi.fn().mockReturnValue({
    merged: vi.fn().mockReturnValue({}),
  }),
}));

describe('validateAuthMethod', () => {
  beforeEach(() => {
    vi.stubEnv('GEMINI_API_KEY', undefined);
    vi.stubEnv('GOOGLE_CLOUD_PROJECT', undefined);
    vi.stubEnv('GOOGLE_CLOUD_LOCATION', undefined);
    vi.stubEnv('GOOGLE_API_KEY', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    {
      description:
        'should return error message for OPENAI_COMPATIBLE if endpoint is not set',
      authType: AuthType.OPENAI_COMPATIBLE,
      envs: {},
      expected:
        '使用 OpenAI 兼容 API 时，必须配置端点 URL。\n' +
        '请重新运行认证流程以提供端点、API 密钥和模型。',
    },
    {
      description: 'should return an error message for an invalid auth method',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      authType: 'invalid-method' as any,
      envs: {},
      expected:
        '当前仅支持 OpenAI 兼容端点认证方式。请选择 OpenAI Compatible 作为认证方法。',
    },
  ])('$description', ({ authType, envs, expected }) => {
    for (const [key, value] of Object.entries(envs)) {
      vi.stubEnv(key, value as string);
    }
    expect(validateAuthMethod(authType)).toBe(expected);
  });
});
