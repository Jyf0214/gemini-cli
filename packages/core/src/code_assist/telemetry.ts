/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { FinishReason, type GenerateContentResponse } from '@google/genai';
import { getCitations } from '../utils/generateContentResponseUtilities.js';
import {
  ActionStatus,
  InitiationMethod,
  type ConversationOffered,
  type StreamingLatency,
} from './types.js';
import type { CompletedToolCall } from '../scheduler/types.js';
import type { Config } from '../config/config.js';
import { debugLogger } from '../utils/debugLogger.js';
import { EDIT_TOOL_NAMES } from '../tools/tool-names.js';
import { getErrorMessage } from '../utils/errors.js';
import type { CodeAssistServer } from './server.js';

export async function recordConversationOffered(
  server: CodeAssistServer,
  traceId: string | undefined,
  response: GenerateContentResponse,
  streamingLatency: StreamingLatency,
  abortSignal: AbortSignal | undefined,
  trajectoryId: string | undefined,
): Promise<void> {
  try {
    if (traceId) {
      const offered = createConversationOffered(
        response,
        traceId,
        abortSignal,
        streamingLatency,
        trajectoryId,
      );
      if (offered) {
        await server.recordConversationOffered(offered);
      }
    }
  } catch (error: unknown) {
    debugLogger.warn(
      `Error recording tool call interactions: ${getErrorMessage(error)}`,
    );
  }
}

export async function recordToolCallInteractions(
  _config: Config,
  _toolCalls: CompletedToolCall[],
): Promise<void> {
  // Code Assist is no longer supported; skip telemetry recording.
  return;
}

export function createConversationOffered(
  response: GenerateContentResponse,
  traceId: string,
  signal: AbortSignal | undefined,
  streamingLatency: StreamingLatency,
  trajectoryId: string | undefined,
): ConversationOffered | undefined {
  // Only send conversation offered events for responses that contain edit
  // function calls. Non-edit function calls don't represent file modifications.
  if (
    !response.functionCalls ||
    !response.functionCalls.some((call) => EDIT_TOOL_NAMES.has(call.name || ''))
  ) {
    return;
  }

  const actionStatus = getStatusFromResponse(response, signal);

  return {
    citationCount: String(getCitations(response).length),
    includedCode: includesCode(response),
    status: actionStatus,
    traceId,
    streamingLatency,
    isAgentic: true,
    initiationMethod: InitiationMethod.COMMAND,
    trajectoryId,
  };
}

function includesCode(resp: GenerateContentResponse): boolean {
  if (!resp.candidates) {
    return false;
  }
  for (const candidate of resp.candidates) {
    if (!candidate.content || !candidate.content.parts) {
      continue;
    }
    for (const part of candidate.content.parts) {
      if ('text' in part && part?.text?.includes('```')) {
        return true;
      }
    }
  }
  return false;
}

function getStatusFromResponse(
  response: GenerateContentResponse,
  signal: AbortSignal | undefined,
): ActionStatus {
  if (signal?.aborted) {
    return ActionStatus.ACTION_STATUS_CANCELLED;
  }

  if (hasError(response)) {
    return ActionStatus.ACTION_STATUS_ERROR_UNKNOWN;
  }

  if ((response.candidates?.length ?? 0) <= 0) {
    return ActionStatus.ACTION_STATUS_EMPTY;
  }

  return ActionStatus.ACTION_STATUS_NO_ERROR;
}

export function formatProtoJsonDuration(milliseconds: number): string {
  return `${milliseconds / 1000}s`;
}

function hasError(response: GenerateContentResponse): boolean {
  // Non-OK SDK results should be considered an error.
  if (
    response.sdkHttpResponse &&
    !response.sdkHttpResponse?.responseInternal?.ok
  ) {
    return true;
  }

  for (const candidate of response.candidates || []) {
    // Treat sanitization, SPII, recitation, and forbidden terms as an error.
    if (
      candidate.finishReason &&
      candidate.finishReason !== FinishReason.STOP &&
      candidate.finishReason !== FinishReason.MAX_TOKENS
    ) {
      return true;
    }
  }
  return false;
}
