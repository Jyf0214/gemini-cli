/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  geminiFunctionCallToOpenAI,
  openAIToolCallToGemini,
  geminiFunctionResponseToOpenAIMessage,
  openAIMessageToGeminiContent,
  geminiToolToOpenAI,
  openAIToolToGemini,
  geminiContentsToOpenAIMessages,
  openAIResponseToGeminiParts,
  FunctionCallTranslator,
  type GeminiFunctionCall,
  type OpenAIToolCall,
  type GeminiFunctionResponse,
  type OpenAIMessage,
  type GeminiContent,
  type GeminiToolDefinition,
  type OpenAIToolDefinition,
} from './functionCallTranslator.js';

// ==================== 无状态函数测试 ====================

describe('geminiFunctionCallToOpenAI', () => {
  it('should convert Gemini function call to OpenAI format', () => {
    const gemini: GeminiFunctionCall = {
      name: 'get_weather',
      args: { city: 'Shanghai', unit: 'celsius' },
    };

    const result = geminiFunctionCallToOpenAI(gemini);

    expect(result.type).toBe('function');
    expect(result.function.name).toBe('get_weather');
    expect(result.function.arguments).toBe(
      '{"city":"Shanghai","unit":"celsius"}',
    );
    expect(result.id).toMatch(/^call_\d+_[a-z0-9]+$/);
  });

  it('should use provided id when given', () => {
    const gemini: GeminiFunctionCall = {
      name: 'test_fn',
      args: {},
    };

    const result = geminiFunctionCallToOpenAI(gemini, 'custom_id_123');

    expect(result.id).toBe('custom_id_123');
  });

  it('should handle empty args', () => {
    const gemini: GeminiFunctionCall = {
      name: 'no_args_fn',
      args: {},
    };

    const result = geminiFunctionCallToOpenAI(gemini);

    expect(result.function.arguments).toBe('{}');
  });

  it('should handle missing args by defaulting to empty object', () => {
    const gemini = { name: 'fn' } as GeminiFunctionCall;

    const result = geminiFunctionCallToOpenAI(gemini);

    expect(result.function.arguments).toBe('{}');
  });

  it('should throw when name is empty', () => {
    expect(() => geminiFunctionCallToOpenAI({ name: '', args: {} })).toThrow(
      'non-empty name',
    );
  });
});

describe('openAIToolCallToGemini', () => {
  it('should convert OpenAI tool call to Gemini format', () => {
    const openai: OpenAIToolCall = {
      id: 'call_123',
      type: 'function',
      function: {
        name: 'get_weather',
        arguments: '{"city":"Shanghai"}',
      },
    };

    const result = openAIToolCallToGemini(openai);

    expect(result.name).toBe('get_weather');
    expect(result.args).toEqual({ city: 'Shanghai' });
  });

  it('should handle empty arguments string', () => {
    const openai: OpenAIToolCall = {
      id: 'call_123',
      type: 'function',
      function: { name: 'fn', arguments: '' },
    };

    const result = openAIToolCallToGemini(openai);

    expect(result.args).toEqual({});
  });

  it('should throw on invalid JSON arguments', () => {
    const openai: OpenAIToolCall = {
      id: 'call_123',
      type: 'function',
      function: { name: 'fn', arguments: '{invalid json}' },
    };

    expect(() => openAIToolCallToGemini(openai)).toThrow(
      'Failed to parse OpenAI tool call arguments',
    );
  });

  it('should throw when function name is empty', () => {
    const openai: OpenAIToolCall = {
      id: 'call_123',
      type: 'function',
      function: { name: '', arguments: '{}' },
    };

    expect(() => openAIToolCallToGemini(openai)).toThrow(
      'non-empty function name',
    );
  });

  it('should throw when arguments parse to non-object', () => {
    const openai: OpenAIToolCall = {
      id: 'call_123',
      type: 'function',
      function: { name: 'fn', arguments: '"just a string"' },
    };

    // JSON.parse('"just a string"') returns a string, not an object
    // The function should still return empty args since parsed is not an object
    const result = openAIToolCallToGemini(openai);
    expect(result.args).toEqual({});
  });
});

describe('geminiFunctionResponseToOpenAIMessage', () => {
  it('should convert Gemini response to OpenAI tool message', () => {
    const response: GeminiFunctionResponse = {
      name: 'get_weather',
      response: { temperature: 25, unit: 'celsius' },
    };

    const result = geminiFunctionResponseToOpenAIMessage(response, 'call_123');

    expect(result.role).toBe('tool');
    expect(result.tool_call_id).toBe('call_123');
    expect(result.content).toBe('{"temperature":25,"unit":"celsius"}');
  });

  it('should handle empty response', () => {
    const response: GeminiFunctionResponse = {
      name: 'fn',
      response: {},
    };

    const result = geminiFunctionResponseToOpenAIMessage(response, 'call_1');

    expect(result.content).toBe('{}');
  });

  it('should throw when toolCallId is empty', () => {
    const response: GeminiFunctionResponse = {
      name: 'fn',
      response: {},
    };

    expect(() => geminiFunctionResponseToOpenAIMessage(response, '')).toThrow(
      'toolCallId is required',
    );
  });
});

describe('openAIMessageToGeminiContent', () => {
  it('should convert user message', () => {
    const msg: OpenAIMessage = {
      role: 'user',
      content: 'Hello',
    };

    const result = openAIMessageToGeminiContent(msg);

    expect(result.role).toBe('user');
    expect(result.parts).toEqual([{ text: 'Hello' }]);
  });

  it('should convert assistant message', () => {
    const msg: OpenAIMessage = {
      role: 'assistant',
      content: 'Hi there!',
    };

    const result = openAIMessageToGeminiContent(msg);

    expect(result.role).toBe('model');
    expect(result.parts).toEqual([{ text: 'Hi there!' }]);
  });

  it('should convert assistant message with tool calls', () => {
    const msg: OpenAIMessage = {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'get_weather', arguments: '{"city":"Shanghai"}' },
        },
      ],
    };

    const result = openAIMessageToGeminiContent(msg);

    expect(result.role).toBe('model');
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0].functionCall).toEqual({
      name: 'get_weather',
      args: { city: 'Shanghai' },
    });
  });

  it('should convert tool response message', () => {
    const msg: OpenAIMessage = {
      role: 'tool',
      tool_call_id: 'call_123',
      content: '{"temp":25}',
    };

    const result = openAIMessageToGeminiContent(msg);

    expect(result.role).toBe('user');
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0].functionResponse).toEqual({
      name: 'call_123',
      response: { temp: 25 },
    });
  });

  it('should handle tool response with non-JSON content', () => {
    const msg: OpenAIMessage = {
      role: 'tool',
      tool_call_id: 'call_123',
      content: 'plain text response',
    };

    const result = openAIMessageToGeminiContent(msg);

    expect(result.parts[0].functionResponse).toEqual({
      name: 'call_123',
      response: { text: 'plain text response' },
    });
  });

  it('should handle message with no content', () => {
    const msg: OpenAIMessage = { role: 'user' };

    const result = openAIMessageToGeminiContent(msg);

    expect(result.parts).toEqual([]);
  });
});

describe('geminiToolToOpenAI', () => {
  it('should convert functionDeclarations array', () => {
    const tool: GeminiToolDefinition = {
      functionDeclarations: [
        {
          name: 'get_weather',
          description: 'Get weather info',
          parameters: {
            type: 'object',
            properties: { city: { type: 'string' } },
          },
        },
        {
          name: 'get_time',
          description: 'Get current time',
        },
      ],
    };

    const result = geminiToolToOpenAI(tool);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get weather info',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string' } },
        },
      },
    });
    expect(result[1].function.name).toBe('get_time');
  });

  it('should convert single tool definition', () => {
    const tool: GeminiToolDefinition = {
      name: 'my_tool',
      description: 'A tool',
    };

    const result = geminiToolToOpenAI(tool);

    expect(result).toHaveLength(1);
    expect(result[0].function.name).toBe('my_tool');
    expect(result[0].function.description).toBe('A tool');
  });

  it('should return empty array for empty tool definition', () => {
    const tool: GeminiToolDefinition = {};

    const result = geminiToolToOpenAI(tool);

    expect(result).toEqual([]);
  });
});

describe('openAIToolToGemini', () => {
  it('should convert OpenAI tools to Gemini format', () => {
    const tools: OpenAIToolDefinition[] = [
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];

    const result = openAIToolToGemini(tools);

    expect(result.functionDeclarations).toHaveLength(1);
    expect(result.functionDeclarations![0]).toEqual({
      name: 'get_weather',
      description: 'Get weather',
      parameters: { type: 'object', properties: {} },
    });
  });

  it('should handle empty array', () => {
    const result = openAIToolToGemini([]);

    expect(result.functionDeclarations).toEqual([]);
  });
});

describe('geminiContentsToOpenAIMessages', () => {
  it('should convert a conversation with text messages', () => {
    const contents: GeminiContent[] = [
      { role: 'user', parts: [{ text: 'Hello' }] },
      { role: 'model', parts: [{ text: 'Hi!' }] },
    ];

    const result = geminiContentsToOpenAIMessages(contents);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ role: 'user', content: 'Hello' });
    expect(result[1]).toEqual({ role: 'assistant', content: 'Hi!' });
  });

  it('should convert function call and response pair', () => {
    const contents: GeminiContent[] = [
      {
        role: 'model',
        parts: [
          { functionCall: { name: 'get_weather', args: { city: 'Shanghai' } } },
        ],
      },
      {
        role: 'user',
        parts: [
          {
            functionResponse: {
              name: 'get_weather',
              response: { temp: 25 },
            },
          },
        ],
      },
    ];

    const result = geminiContentsToOpenAIMessages(contents);

    expect(result).toHaveLength(2);

    // First message: assistant with tool_calls
    expect(result[0].role).toBe('assistant');
    expect(result[0].tool_calls).toHaveLength(1);
    expect(result[0].tool_calls![0].function.name).toBe('get_weather');

    // Second message: tool response with matching ID
    expect(result[1].role).toBe('tool');
    expect(result[1].tool_call_id).toBe(result[0].tool_calls![0].id);
  });

  it('should handle empty contents', () => {
    const result = geminiContentsToOpenAIMessages([]);

    expect(result).toEqual([]);
  });
});

describe('openAIResponseToGeminiParts', () => {
  it('should convert text response', () => {
    const result = openAIResponseToGeminiParts({
      content: 'Hello world',
    });

    expect(result).toEqual([{ text: 'Hello world' }]);
  });

  it('should convert tool calls', () => {
    const result = openAIResponseToGeminiParts({
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'fn', arguments: '{"x":1}' },
        },
      ],
    });

    expect(result).toHaveLength(1);
    expect(result[0].functionCall).toEqual({ name: 'fn', args: { x: 1 } });
  });

  it('should convert mixed response', () => {
    const result = openAIResponseToGeminiParts({
      content: 'Let me check that',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'fn', arguments: '{}' },
        },
      ],
    });

    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('Let me check that');
    expect(result[1].functionCall).toBeDefined();
  });

  it('should handle empty response', () => {
    const result = openAIResponseToGeminiParts({});

    expect(result).toEqual([]);
  });
});

// ==================== FunctionCallTranslator 类测试 ====================

describe('FunctionCallTranslator', () => {
  let translator: FunctionCallTranslator;

  beforeEach(() => {
    translator = new FunctionCallTranslator();
  });

  describe('translateFunctionCall', () => {
    it('should translate and track ID mapping', () => {
      const gemini: GeminiFunctionCall = {
        name: 'get_weather',
        args: { city: 'Beijing' },
      };

      const result = translator.translateFunctionCall(gemini);

      expect(result.type).toBe('function');
      expect(result.function.name).toBe('get_weather');
      expect(result.id).toBeDefined();

      // Verify mapping was recorded
      expect(translator.getToolCallId('get_weather')).toBe(result.id);
      expect(translator.getFunctionName(result.id)).toBe('get_weather');
    });
  });

  describe('translateToolCall', () => {
    it('should translate and track ID mapping', () => {
      const openai: OpenAIToolCall = {
        id: 'my_call_id',
        type: 'function',
        function: { name: 'get_time', arguments: '{"tz":"UTC"}' },
      };

      const result = translator.translateToolCall(openai);

      expect(result.name).toBe('get_time');
      expect(result.args).toEqual({ tz: 'UTC' });

      // Verify mapping
      expect(translator.getToolCallId('get_time')).toBe('my_call_id');
      expect(translator.getFunctionName('my_call_id')).toBe('get_time');
    });
  });

  describe('clearMappings', () => {
    it('should clear all ID mappings', () => {
      translator.translateFunctionCall({ name: 'fn', args: {} });
      expect(translator.mappingCount).toBe(1);

      translator.clearMappings();

      expect(translator.mappingCount).toBe(0);
      expect(translator.getToolCallId('fn')).toBeUndefined();
    });
  });

  describe('mappingCount', () => {
    it('should return the number of mappings', () => {
      expect(translator.mappingCount).toBe(0);

      translator.translateFunctionCall({ name: 'fn1', args: {} });
      expect(translator.mappingCount).toBe(1);

      translator.translateFunctionCall({ name: 'fn2', args: {} });
      expect(translator.mappingCount).toBe(2);

      // Same name should not increase count
      translator.translateFunctionCall({ name: 'fn1', args: {} });
      expect(translator.mappingCount).toBe(2);
    });
  });

  describe('getToolCallId', () => {
    it('should return undefined for unknown function', () => {
      expect(translator.getToolCallId('unknown')).toBeUndefined();
    });
  });

  describe('getFunctionName', () => {
    it('should return undefined for unknown ID', () => {
      expect(translator.getFunctionName('unknown_id')).toBeUndefined();
    });
  });

  describe('translateGeminiContentToOpenAI', () => {
    it('should convert text content', () => {
      const content: GeminiContent = {
        role: 'user',
        parts: [{ text: 'Hello' }],
      };

      const result = translator.translateGeminiContentToOpenAI(content);

      expect(result.role).toBe('user');
      expect(result.content).toBe('Hello');
      expect(result.tool_calls).toBeUndefined();
    });

    it('should convert model content with function call', () => {
      const content: GeminiContent = {
        role: 'model',
        parts: [
          { functionCall: { name: 'get_weather', args: { city: 'Tokyo' } } },
        ],
      };

      const result = translator.translateGeminiContentToOpenAI(content);

      expect(result.role).toBe('assistant');
      expect(result.tool_calls).toHaveLength(1);
      expect(result.tool_calls![0].function.name).toBe('get_weather');

      // Verify mapping is tracked
      const id = translator.getToolCallId('get_weather');
      expect(id).toBeDefined();
      expect(translator.getFunctionName(id!)).toBe('get_weather');
    });

    it('should convert mixed content with text and function call', () => {
      const content: GeminiContent = {
        role: 'model',
        parts: [
          { text: 'Let me check' },
          { functionCall: { name: 'fn', args: {} } },
        ],
      };

      const result = translator.translateGeminiContentToOpenAI(content);

      expect(result.content).toBe('Let me check');
      expect(result.tool_calls).toHaveLength(1);
    });
  });

  describe('translateOpenAIMessageToGemini', () => {
    it('should convert user message', () => {
      const msg: OpenAIMessage = {
        role: 'user',
        content: 'What time is it?',
      };

      const result = translator.translateOpenAIMessageToGemini(msg);

      expect(result.role).toBe('user');
      expect(result.parts).toEqual([{ text: 'What time is it?' }]);
    });

    it('should convert assistant message with tool calls', () => {
      const msg: OpenAIMessage = {
        role: 'assistant',
        tool_calls: [
          {
            id: 'call_abc',
            type: 'function',
            function: { name: 'get_time', arguments: '{}' },
          },
        ],
      };

      const result = translator.translateOpenAIMessageToGemini(msg);

      expect(result.role).toBe('model');
      expect(result.parts[0].functionCall).toEqual({
        name: 'get_time',
        args: {},
      });

      // Verify mapping
      expect(translator.getToolCallId('get_time')).toBe('call_abc');
    });

    it('should convert tool response using tracked mapping', () => {
      // First, record a mapping by translating a function call
      translator.translateFunctionCall({
        name: 'get_weather',
        args: {},
      });
      const toolCallId = translator.getToolCallId('get_weather')!;

      const msg: OpenAIMessage = {
        role: 'tool',
        tool_call_id: toolCallId,
        content: '{"temp":30}',
      };

      const result = translator.translateOpenAIMessageToGemini(msg);

      expect(result.role).toBe('user');
      expect(result.parts[0].functionResponse).toEqual({
        name: 'get_weather',
        response: { temp: 30 },
      });
    });

    it('should fall back to tool_call_id as name when mapping not found', () => {
      const msg: OpenAIMessage = {
        role: 'tool',
        tool_call_id: 'unknown_id',
        content: '{"result":1}',
      };

      const result = translator.translateOpenAIMessageToGemini(msg);

      expect(result.parts[0].functionResponse!.name).toBe('unknown_id');
    });

    it('should handle tool response with non-JSON content', () => {
      const msg: OpenAIMessage = {
        role: 'tool',
        tool_call_id: 'call_1',
        content: 'plain text',
      };

      const result = translator.translateOpenAIMessageToGemini(msg);

      expect(result.parts[0].functionResponse!.response).toEqual({
        text: 'plain text',
      });
    });
  });
});

// ==================== 往返转换测试 ====================

describe('round-trip conversions', () => {
  it('should round-trip Gemini function call -> OpenAI -> Gemini', () => {
    const original: GeminiFunctionCall = {
      name: 'calculate',
      args: { a: 1, b: 2, op: 'add' },
    };

    const openai = geminiFunctionCallToOpenAI(original);
    const roundTripped = openAIToolCallToGemini(openai);

    expect(roundTripped).toEqual(original);
  });

  it('should round-trip OpenAI tool call -> Gemini -> OpenAI', () => {
    const original: OpenAIToolCall = {
      id: 'test_id',
      type: 'function',
      function: { name: 'search', arguments: '{"query":"hello"}' },
    };

    const gemini = openAIToolCallToGemini(original);
    const roundTripped = geminiFunctionCallToOpenAI(gemini, original.id);

    expect(roundTripped).toEqual(original);
  });

  it('should round-trip tool definitions', () => {
    const original: OpenAIToolDefinition[] = [
      {
        type: 'function',
        function: {
          name: 'fn1',
          description: 'desc1',
          parameters: { type: 'object', properties: {} },
        },
      },
    ];

    const gemini = openAIToolToGemini(original);
    const roundTripped = geminiToolToOpenAI(gemini);

    expect(roundTripped).toEqual(original);
  });
});
