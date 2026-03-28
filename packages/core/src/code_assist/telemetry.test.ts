/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createConversationOffered,
  formatProtoJsonDuration,
  recordConversationOffered,
  recordToolCallInteractions,
} from './telemetry.js';
import {
  ActionStatus,
  InitiationMethod,
  type StreamingLatency,
} from './types.js';
import {
  FinishReason,
  GenerateContentResponse,
  type FunctionCall,
} from '@google/genai';
import type { CodeAssistServer } from './server.js';
import type { CompletedToolCall } from '../scheduler/types.js';
import { ToolConfirmationOutcome } from '../tools/tools.js';
import type { Config } from '../config/config.js';

function createMockResponse(
  candidates: GenerateContentResponse['candidates'] = [],
  ok = true,
  functionCalls: FunctionCall[] | undefined = undefined,
) {
  const response = new GenerateContentResponse();
  response.candidates = candidates;
  response.sdkHttpResponse = {
    responseInternal: {
      ok,
    } as unknown as Response,
    json: async () => ({}),
  };

  // If functionCalls is explicitly provided, mock the getter.
  // Otherwise, let the default behavior (if any) or undefined prevail.
  // In the real SDK, functionCalls is a getter derived from candidates.
  // For testing `createConversationOffered` which guards on functionCalls,
  // we often need to force it to be present.
  if (functionCalls !== undefined) {
    Object.defineProperty(response, 'functionCalls', {
      get: () => functionCalls,
      configurable: true,
    });
  }

  return response;
}

describe('telemetry', () => {
  describe('createConversationOffered', () => {
    it('should create a ConversationOffered object with correct values', () => {
      const response = createMockResponse(
        [
          {
            index: 0,
            content: {
              role: 'model',
              parts: [{ text: 'response with ```code```' }],
            },
            citationMetadata: {
              citations: [
                { uri: 'https://example.com', startIndex: 0, endIndex: 10 },
              ],
            },
            finishReason: FinishReason.STOP,
          },
        ],
        true,
        [{ name: 'replace', args: {} }],
      );
      const traceId = 'test-trace-id';
      const streamingLatency: StreamingLatency = { totalLatency: '1s' };

      const result = createConversationOffered(
        response,
        traceId,
        undefined,
        streamingLatency,
        'trajectory-id',
      );

      expect(result).toEqual({
        citationCount: '1',
        includedCode: true,
        status: ActionStatus.ACTION_STATUS_NO_ERROR,
        traceId,
        streamingLatency,
        isAgentic: true,
        initiationMethod: InitiationMethod.COMMAND,
        trajectoryId: 'trajectory-id',
      });
    });

    it('should return undefined if no function calls', () => {
      const response = createMockResponse(
        [
          {
            index: 0,
            content: {
              role: 'model',
              parts: [{ text: 'response without function calls' }],
            },
          },
        ],
        true,
        [], // Empty function calls
      );
      const result = createConversationOffered(
        response,
        'trace-id',
        undefined,
        {},
        'trajectory-id',
      );
      expect(result).toBeUndefined();
    });

    it('should set status to CANCELLED if signal is aborted', () => {
      const response = createMockResponse([], true, [
        { name: 'replace', args: {} },
      ]);
      const signal = new AbortController().signal;
      vi.spyOn(signal, 'aborted', 'get').mockReturnValue(true);

      const result = createConversationOffered(
        response,
        'trace-id',
        signal,
        {},
        'trajectory-id',
      );

      expect(result?.status).toBe(ActionStatus.ACTION_STATUS_CANCELLED);
    });

    it('should set status to ERROR_UNKNOWN if response has error (non-OK SDK response)', () => {
      const response = createMockResponse([], false, [
        { name: 'replace', args: {} },
      ]);

      const result = createConversationOffered(
        response,
        'trace-id',
        undefined,
        {},
        'trajectory-id',
      );

      expect(result?.status).toBe(ActionStatus.ACTION_STATUS_ERROR_UNKNOWN);
    });

    it('should set status to ERROR_UNKNOWN if finishReason is not STOP or MAX_TOKENS', () => {
      const response = createMockResponse(
        [
          {
            index: 0,
            finishReason: FinishReason.SAFETY,
          },
        ],
        true,
        [{ name: 'replace', args: {} }],
      );

      const result = createConversationOffered(
        response,
        'trace-id',
        undefined,
        {},
        'trajectory-id',
      );

      expect(result?.status).toBe(ActionStatus.ACTION_STATUS_ERROR_UNKNOWN);
    });

    it('should set status to EMPTY if candidates is empty', () => {
      // We force functionCalls to be present to bypass the guard,
      // simulating a state where we want to test the candidates check.
      const response = createMockResponse([], true, [
        { name: 'replace', args: {} },
      ]);

      const result = createConversationOffered(
        response,
        'trace-id',
        undefined,
        {},
        undefined,
      );

      expect(result?.status).toBe(ActionStatus.ACTION_STATUS_EMPTY);
    });

    it('should detect code in response', () => {
      const response = createMockResponse(
        [
          {
            index: 0,
            content: {
              parts: [
                { text: 'Here is some code:\n```js\nconsole.log("hi")\n```' },
              ],
            },
          },
        ],
        true,
        [{ name: 'replace', args: {} }],
      );
      const result = createConversationOffered(
        response,
        'id',
        undefined,
        {},
        undefined,
      );
      expect(result?.includedCode).toBe(true);
    });

    it('should not detect code if no backticks', () => {
      const response = createMockResponse(
        [
          {
            index: 0,
            content: {
              parts: [{ text: 'Here is some text.' }],
            },
          },
        ],
        true,
        [{ name: 'replace', args: {} }],
      );
      const result = createConversationOffered(
        response,
        'id',
        undefined,
        {},
        undefined,
      );
      expect(result?.includedCode).toBe(false);
    });
  });

  describe('formatProtoJsonDuration', () => {
    it('should format milliseconds to seconds string', () => {
      expect(formatProtoJsonDuration(1500)).toBe('1.5s');
      expect(formatProtoJsonDuration(100)).toBe('0.1s');
    });
  });

  describe('recordConversationOffered', () => {
    it('should call server.recordConversationOffered if traceId is present', async () => {
      const serverMock = {
        recordConversationOffered: vi.fn(),
      } as unknown as CodeAssistServer;

      const response = createMockResponse([], true, [
        { name: 'replace', args: {} },
      ]);
      const streamingLatency = {};

      await recordConversationOffered(
        serverMock,
        'trace-id',
        response,
        streamingLatency,
        undefined,
        undefined,
      );

      expect(serverMock.recordConversationOffered).toHaveBeenCalledWith(
        expect.objectContaining({
          traceId: 'trace-id',
        }),
      );
    });

    it('should not call server.recordConversationOffered if traceId is undefined', async () => {
      const serverMock = {
        recordConversationOffered: vi.fn(),
      } as unknown as CodeAssistServer;
      const response = createMockResponse([], true, [
        { name: 'replace', args: {} },
      ]);

      await recordConversationOffered(
        serverMock,
        undefined,
        response,
        {},
        undefined,
        undefined,
      );

      expect(serverMock.recordConversationOffered).not.toHaveBeenCalled();
    });
  });

  describe('recordToolCallInteractions', () => {
    it('should not record any interactions (Code Assist is no longer supported)', async () => {
      const toolCalls: CompletedToolCall[] = [
        {
          request: {
            name: 'replace',
            args: {},
            callId: 'call-1',
            isClientInitiated: false,
            prompt_id: 'p1',
            traceId: 'trace-1',
          },
          response: {
            resultDisplay: {
              diffStat: {
                model_added_lines: 5,
                model_removed_lines: 3,
              },
            },
          },
          outcome: ToolConfirmationOutcome.ProceedOnce,
          status: 'success',
        } as unknown as CompletedToolCall,
      ];

      // Should return without error even though Code Assist is no longer supported
      await expect(
        recordToolCallInteractions({} as Config, toolCalls),
      ).resolves.toBeUndefined();
    });

    it('should handle empty tool calls', async () => {
      await expect(
        recordToolCallInteractions({} as Config, []),
      ).resolves.toBeUndefined();
    });
  });
});
