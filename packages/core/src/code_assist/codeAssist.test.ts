/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthType } from '../core/contentGenerator.js';
import {
  createCodeAssistContentGenerator,
  getCodeAssistServer,
} from './codeAssist.js';
import type { Config } from '../config/config.js';

describe('codeAssist', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('createCodeAssistContentGenerator', () => {
    const httpOptions = {};
    const mockConfig = {} as unknown as Config;

    it('should throw an error for OPENAI_COMPATIBLE auth type', async () => {
      await expect(
        createCodeAssistContentGenerator(
          httpOptions,
          AuthType.OPENAI_COMPATIBLE,
          mockConfig,
          'session-123',
        ),
      ).rejects.toThrow(
        'Code Assist 认证方式已不再支持，当前仅支持 OpenAI 兼容端点',
      );
    });

    it('should throw an error for any auth type', async () => {
      await expect(
        createCodeAssistContentGenerator(
          httpOptions,
          'api-key' as AuthType,
          mockConfig,
        ),
      ).rejects.toThrow(
        'Code Assist 认证方式已不再支持，当前仅支持 OpenAI 兼容端点',
      );
    });
  });

  describe('getCodeAssistServer', () => {
    it('should always return undefined', () => {
      const mockConfig = {
        getContentGenerator: () => ({ a: 'generator' }),
      } as unknown as Config;

      const server = getCodeAssistServer(mockConfig);
      expect(server).toBeUndefined();
    });
  });
});
