/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-unsafe-type-assertion */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-return */

import {
  GenerateContentResponse,
  type GenerateContentParameters,
  type CountTokensParameters,
  type CountTokensResponse,
  type EmbedContentParameters,
  type EmbedContentResponse,
  FinishReason,
} from '@google/genai';
import type { ContentGenerator } from './contentGenerator.js';
import type { UserTierId, GeminiUserTier } from '../code_assist/types.js';
import type { LlmRole } from '../telemetry/llmRole.js';
import { debugLogger } from '../utils/debugLogger.js';
import {
  geminiContentsToOpenAIMessages,
  geminiToolToOpenAI,
  openAIResponseToGeminiParts,
} from './functionCallTranslator.js';

interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

interface OpenAIStreamChunk {
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
      reasoning?: string;
    };
    finish_reason: string | null;
  }>;
}

/**
 * OpenAI 兼容端点的内容生成器
 * 支持 OpenAI SDK 规范的端点（如 Deepseek、Qwen、Kimi 等）
 */
export class OpenAIContentGenerator implements ContentGenerator {
  private apiKey: string;
  private baseUrl: string;

  userTier?: UserTierId;
  userTierName?: string;
  paidTier?: GeminiUserTier;

  constructor(apiKey: string, baseUrl: string) {
    this.apiKey = apiKey;
    // 移除末尾的斜杠
    let cleanUrl = baseUrl.replace(/\/$/, '');
    // 如果 URL 以 /v1 结尾，移除它（因为后续会统一添加 /v1/chat/completions）
    if (cleanUrl.endsWith('/v1')) {
      cleanUrl = cleanUrl.slice(0, -3);
    }
    this.baseUrl = cleanUrl;
    debugLogger.debug('OpenAIContentGenerator initialized:', {
      baseUrl: this.baseUrl,
      apiKey: apiKey ? '***' : 'empty',
    });
  }

  async generateContent(
    req: GenerateContentParameters,
    _userPromptId: string,
    _role: LlmRole,
  ): Promise<GenerateContentResponse> {
    debugLogger.debug('generateContent called:', {
      model: (req as any).model,
      hasTools: !!(req as any).config?.tools,
      config: (req as any).config,
    });

    const contents = this.toContents((req as any).contents);
    const messages = this.convertToOpenAIMessages(contents);
    const model = ((req as any).model || 'gpt-3.5-turbo') as string;
    const tools = (req as any).config?.tools
      ? this.convertToOpenAITools((req as any).config.tools)
      : undefined;

    const body: Record<string, unknown> = {
      model,
      messages,
      stream: false,
    };

    if ((req as any).config?.temperature !== undefined)
      body['temperature'] = (req as any).config.temperature;
    if ((req as any).config?.topP !== undefined)
      body['top_p'] = (req as any).config.topP;
    if ((req as any).config?.topK !== undefined)
      body['top_k'] = (req as any).config.topK;
    if ((req as any).config?.maxOutputTokens !== undefined)
      body['max_tokens'] = (req as any).config.maxOutputTokens;

    if (tools) {
      body['tools'] = tools;
    }

    const url = `${this.baseUrl}/v1/chat/completions`;
    debugLogger.debug('Sending request to OpenAI API:', {
      url,
      model,
      messageCount: messages.length,
      hasTools: !!tools,
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    debugLogger.debug('OpenAI API response status:', {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
    });

    if (!response.ok) {
      const error = await response.text();
      debugLogger.error('OpenAI API error:', {
        status: response.status,
        statusText: response.statusText,
        error,
      });
      throw new Error(`OpenAI API error: ${response.status} ${error}`);
    }

    const data = await response.json();
    return this.convertOpenAIResponseToGemini(data);
  }

  async generateContentStream(
    req: GenerateContentParameters,
    _userPromptId: string,
    _role: LlmRole,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    debugLogger.debug('generateContentStream called:', {
      model: (req as any).model,
      hasTools: !!(req as any).config?.tools,
      stream: true,
    });

    // 使用 IIFE 模式保存上下文
    return (async function* (
      self: OpenAIContentGenerator,
    ): AsyncGenerator<GenerateContentResponse> {
      const contents = self.toContents(req.contents);
      const messages = self.convertToOpenAIMessages(contents);
      const model = (req as any).model || 'gpt-3.5-turbo';
      const tools = (req as any).config?.tools
        ? self.convertToOpenAITools((req as any).config.tools)
        : undefined;

      const body: Record<string, unknown> = {
        model,
        messages,
        stream: true,
      };

      if ((req as any).config?.temperature !== undefined)
        body['temperature'] = (req as any).config.temperature;
      if ((req as any).config?.topP !== undefined)
        body['top_p'] = (req as any).config.topP;
      if ((req as any).config?.topK !== undefined)
        body['top_k'] = (req as any).config.topK;
      if ((req as any).config?.maxOutputTokens !== undefined)
        body['max_tokens'] = (req as any).config.maxOutputTokens;

      if (tools) {
        body['tools'] = tools;
      }

      const url = `${self.baseUrl}/v1/chat/completions`;
      debugLogger.debug('Sending streaming request to OpenAI API:', {
        url,
        model,
        messageCount: messages.length,
        hasTools: !!tools,
        stream: true,
      });

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${self.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      debugLogger.debug('OpenAI API streaming response status:', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
      });

      if (!response.ok) {
        const error = await response.text();
        debugLogger.error('OpenAI API streaming error:', {
          status: response.status,
          statusText: response.statusText,
          error,
        });
        throw new Error(`OpenAI API error: ${response.status} ${error}`);
      }

      yield* self.streamResponse(response);
    })(this);
  }

  private async *streamResponse(
    response: globalThis.Response,
  ): AsyncGenerator<GenerateContentResponse> {
    const body = response.body;
    if (!body) {
      throw new Error('Response body is null');
    }

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // 用于累积 tool_calls 的参数
    const pendingToolCalls: Map<
      number,
      { id: string; name: string; args: string }
    > = new Map();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          // 流结束时，发送累积的 tool_calls
          if (pendingToolCalls.size > 0) {
            const parts =
              this.convertPendingToolCallsToGeminiParts(pendingToolCalls);
            if (parts.length > 0) {
              const out = new GenerateContentResponse();
              out.candidates = [
                {
                  content: { parts, role: 'model' },
                  finishReason: FinishReason.STOP,
                },
              ];
              yield out;
            }
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (trimmedLine.startsWith('data: ')) {
            const dataStr = trimmedLine.slice(6);
            if (dataStr === '[DONE]') {
              // 发送最后累积的 tool_calls
              if (pendingToolCalls.size > 0) {
                const parts =
                  this.convertPendingToolCallsToGeminiParts(pendingToolCalls);
                const out = new GenerateContentResponse();
                out.candidates = [
                  {
                    content: { parts, role: 'model' },
                    finishReason: FinishReason.STOP,
                  },
                ];
                yield out;
              }
              return;
            }

            try {
              const data: OpenAIStreamChunk = JSON.parse(dataStr);

              // 处理 tool_calls 累积
              if (
                data.choices[0]?.delta?.tool_calls &&
                data.choices[0].delta.tool_calls.length > 0
              ) {
                for (const tc of data.choices[0].delta.tool_calls) {
                  const idx = tc.index ?? 0;
                  if (!pendingToolCalls.has(idx)) {
                    pendingToolCalls.set(idx, {
                      id: tc.id || `call_${idx}`,
                      name: tc.function?.name || '',
                      args: '',
                    });
                  }
                  const pending = pendingToolCalls.get(idx)!;
                  if (tc.function?.name) {
                    pending.name = tc.function.name;
                  }
                  if (tc.function?.arguments) {
                    pending.args += tc.function.arguments;
                  }
                }
              }

              // 如果 finish_reason 是 tool_calls，发送累积的 tool_calls
              if (
                data.choices[0]?.finish_reason === 'tool_calls' &&
                pendingToolCalls.size > 0
              ) {
                const parts =
                  this.convertPendingToolCallsToGeminiParts(pendingToolCalls);
                const out = new GenerateContentResponse();
                out.candidates = [
                  {
                    content: { parts, role: 'model' },
                    finishReason: FinishReason.STOP,
                  },
                ];
                yield out;
                pendingToolCalls.clear();
                continue;
              }

              // 普通文本响应
              yield this.convertOpenAIStreamChunkToGemini(data);
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private convertPendingToolCallsToGeminiParts(
    pendingToolCalls: Map<number, { id: string; name: string; args: string }>,
  ): any[] {
    const openAIToolCalls = Array.from(pendingToolCalls.values()).map((tc) => ({
      id: tc.id,
      type: 'function' as const,
      function: {
        name: tc.name,
        arguments: tc.args || '{}',
      },
    }));
    return openAIResponseToGeminiParts({ tool_calls: openAIToolCalls });
  }

  private convertToOpenAIMessages(contents: any[]): OpenAIMessage[] {
    const geminiContents = contents.map((content) => ({
      role: content.role as 'user' | 'model',
      parts: (content.parts || []).map((part: any) => ({
        text: part.text,
        functionCall: part.functionCall
          ? { name: part.functionCall.name, args: part.functionCall.args }
          : undefined,
        functionResponse: part.functionResponse
          ? {
              name: part.functionResponse.name,
              response: part.functionResponse.response,
            }
          : undefined,
      })),
    }));
    return geminiContentsToOpenAIMessages(geminiContents);
  }

  private convertToOpenAITools(tools: any[]): OpenAITool[] {
    return tools.flatMap((tool: any) => {
      const geminiTool = {
        functionDeclarations: tool.functionDeclarations,
        name: tool.name,
        description: tool.description,
      };
      return geminiToolToOpenAI(geminiTool);
    });
  }

  private convertOpenAIResponseToGemini(data: any): GenerateContentResponse {
    const out = new GenerateContentResponse();
    const choice = data.choices?.[0];
    if (!choice) {
      out.candidates = [];
      return out;
    }

    const parts = openAIResponseToGeminiParts({
      content: choice.message?.content,
      tool_calls: choice.message?.tool_calls?.map((tc: any) => ({
        id: tc.id || '',
        type: 'function' as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments || '{}',
        },
      })),
    });

    out.candidates = [
      {
        content: { parts, role: 'model' },
        finishReason: FinishReason.STOP,
      },
    ];
    return out;
  }

  private convertOpenAIStreamChunkToGemini(
    data: OpenAIStreamChunk,
  ): GenerateContentResponse {
    const out = new GenerateContentResponse();
    const choice = data.choices?.[0];
    if (!choice) {
      out.candidates = [];
      return out;
    }

    const parts: any[] = [];
    if (choice.delta?.content) {
      parts.push({ text: choice.delta.content });
    }

    if (choice.delta?.reasoning) {
      parts.push({ text: choice.delta.reasoning });
    }

    out.candidates = [
      {
        content: { parts, role: 'model' },
        finishReason: FinishReason.STOP,
      },
    ];
    return out;
  }

  private toContents(contents: any): any[] {
    if (Array.isArray(contents)) {
      return contents;
    }
    if (contents && typeof contents === 'object') {
      return [contents];
    }
    return [];
  }

  async countTokens(
    request: CountTokensParameters,
  ): Promise<CountTokensResponse> {
    const contents = this.toContents((request as any).contents);
    const text = contents
      .flatMap((c: any) => c.parts ?? [])
      .filter((p: any) => p !== undefined)
      .map((p: any) => p.text || '')
      .join('');
    return { totalTokens: Math.ceil(text.length / 4) };
  }

  async embedContent(
    request: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    const contents = this.toContents((request as any).contents);
    const text = contents
      .flatMap((c: any) => c.parts ?? [])
      .filter((p: any) => p !== undefined)
      .map((p: any) => p.text || '')
      .join('');

    // 简单的嵌入模拟（实际应该调用真实的嵌入API）
    const embedding = text.split('').map((c: string) => c.charCodeAt(0) / 256);

    return {
      embedding: { values: embedding },
    } as EmbedContentResponse;
  }
}
