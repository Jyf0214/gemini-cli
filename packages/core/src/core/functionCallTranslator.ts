/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * OpenAI-Gemini 格式 Function Call 转译层
 *
 * 此模块提供 OpenAI 和 Gemini 格式之间的 function call 转换功能。
 * 主要用于在使用 OpenAI 兼容端点时，将 Gemini 格式的工具调用转换为 OpenAI 格式，
 * 以及将 OpenAI 格式的响应转换回 Gemini 格式。
 *
 * @example
 * ```ts
 * import { geminiFunctionCallToOpenAI, openAIToolCallToGemini } from './functionCallTranslator';
 *
 * // Gemini -> OpenAI
 * const openai = geminiFunctionCallToOpenAI({ name: 'get_weather', args: { city: 'Shanghai' } });
 *
 * // OpenAI -> Gemini
 * const gemini = openAIToolCallToGemini(openai);
 * ```
 */

// ==================== 类型定义 ====================

/**
 * Gemini 格式的函数调用
 */
export interface GeminiFunctionCall {
  /** 函数名称 */
  name: string;
  /** 函数参数，键值对形式 */
  args: Record<string, unknown>;
}

/**
 * Gemini 格式的函数响应
 */
export interface GeminiFunctionResponse {
  /** 函数名称 */
  name: string;
  /** 函数返回结果 */
  response: Record<string, unknown>;
}

/**
 * Gemini 格式的工具定义中的单个函数声明
 */
export interface GeminiFunctionDeclaration {
  /** 函数名称 */
  name: string;
  /** 函数描述 */
  description?: string;
  /** JSON Schema 格式的参数定义 */
  parameters?: Record<string, unknown>;
}

/**
 * Gemini 格式的工具定义
 */
export interface GeminiToolDefinition {
  /** 函数声明数组 */
  functionDeclarations?: GeminiFunctionDeclaration[];
  /** 单个工具名称（兼容格式） */
  name?: string;
  /** 单个工具描述（兼容格式） */
  description?: string;
}

/**
 * OpenAI 格式的工具调用
 */
export interface OpenAIToolCall {
  /** 唯一标识符，用于关联工具调用和响应 */
  id: string;
  /** 工具类型，固定为 'function' */
  type: 'function';
  /** 函数调用详情 */
  function: {
    /** 函数名称 */
    name: string;
    /** JSON 字符串格式的函数参数 */
    arguments: string;
  };
}

/**
 * OpenAI 格式的工具定义
 */
export interface OpenAIToolDefinition {
  /** 工具类型，固定为 'function' */
  type: 'function';
  /** 函数定义详情 */
  function: {
    /** 函数名称 */
    name: string;
    /** 函数描述 */
    description?: string;
    /** JSON Schema 格式的参数定义 */
    parameters?: Record<string, unknown>;
  };
}

/**
 * OpenAI 格式的消息
 */
export interface OpenAIMessage {
  /** 消息角色 */
  role: 'user' | 'assistant' | 'system' | 'tool';
  /** 消息文本内容 */
  content?: string | null;
  /** 工具调用列表（assistant 角色时使用） */
  tool_calls?: OpenAIToolCall[];
  /** 关联的工具调用 ID（tool 角色时使用） */
  tool_call_id?: string;
}

/**
 * Gemini 格式的内容部分
 */
export interface GeminiContentPart {
  /** 文本内容 */
  text?: string;
  /** 是否为思考过程（reasoning） */
  thought?: boolean;
  /** 函数调用 */
  functionCall?: GeminiFunctionCall;
  /** 函数响应 */
  functionResponse?: GeminiFunctionResponse;
}

/**
 * Gemini 格式的内容
 */
export interface GeminiContent {
  /** 角色：user 或 model */
  role: 'user' | 'model';
  /** 内容部分数组 */
  parts: GeminiContentPart[];
}

// ==================== 转译函数 ====================

/**
 * 生成唯一的工具调用 ID
 *
 * 使用时间戳和随机字符串组合，确保同一毫秒内也不会冲突。
 *
 * @returns 格式为 `call_<timestamp>_<random>` 的唯一 ID
 */
function generateToolCallId(): string {
  return `call_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * 将 Gemini 格式的函数调用转换为 OpenAI 格式
 *
 * @param geminiCall - Gemini 格式的函数调用
 * @param id - 可选的工具调用 ID，如果不提供则自动生成
 * @returns OpenAI 格式的工具调用
 * @throws 当 geminiCall.name 为空字符串时抛出错误
 *
 * @example
 * ```ts
 * const openai = geminiFunctionCallToOpenAI({ name: 'get_weather', args: { city: 'Shanghai' } });
 * // => { id: 'call_...', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Shanghai"}' } }
 * ```
 */
export function geminiFunctionCallToOpenAI(
  geminiCall: GeminiFunctionCall,
  id?: string,
): OpenAIToolCall {
  if (!geminiCall.name) {
    throw new Error('Gemini function call must have a non-empty name');
  }

  return {
    id: id || generateToolCallId(),
    type: 'function',
    function: {
      name: geminiCall.name,
      arguments: JSON.stringify(geminiCall.args || {}),
    },
  };
}

/**
 * 将 OpenAI 格式的工具调用转换为 Gemini 格式
 *
 * @param openaiCall - OpenAI 格式的工具调用
 * @returns Gemini 格式的函数调用
 * @throws 当 arguments 不是有效的 JSON 时抛出错误
 *
 * @example
 * ```ts
 * const gemini = openAIToolCallToGemini({
 *   id: 'call_123',
 *   type: 'function',
 *   function: { name: 'get_weather', arguments: '{"city":"Shanghai"}' }
 * });
 * // => { name: 'get_weather', args: { city: 'Shanghai' } }
 * ```
 */
export function openAIToolCallToGemini(
  openaiCall: OpenAIToolCall,
): GeminiFunctionCall {
  if (!openaiCall.function?.name) {
    throw new Error('OpenAI tool call must have a non-empty function name');
  }

  let args: Record<string, unknown> = {};

  try {
    if (openaiCall.function.arguments) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const parsed = JSON.parse(openaiCall.function.arguments);
      if (typeof parsed === 'object' && parsed !== null) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
        args = parsed as Record<string, unknown>;
      }
    }
  } catch (error) {
    throw new Error(
      `Failed to parse OpenAI tool call arguments: ${openaiCall.function.arguments}. Error: ${error}`,
    );
  }

  return {
    name: openaiCall.function.name,
    args,
  };
}

/**
 * 将 Gemini 格式的函数响应转换为 OpenAI 格式的消息
 *
 * @param geminiResponse - Gemini 格式的函数响应
 * @param toolCallId - 对应的工具调用 ID
 * @returns OpenAI 格式的 tool 消息
 * @throws 当 toolCallId 为空时抛出错误
 *
 * @example
 * ```ts
 * const msg = geminiFunctionResponseToOpenAIMessage(
 *   { name: 'get_weather', response: { temp: 25 } },
 *   'call_123'
 * );
 * // => { role: 'tool', tool_call_id: 'call_123', content: '{"temp":25}' }
 * ```
 */
export function geminiFunctionResponseToOpenAIMessage(
  geminiResponse: GeminiFunctionResponse,
  toolCallId: string,
): OpenAIMessage {
  if (!toolCallId) {
    throw new Error('toolCallId is required for function response conversion');
  }

  return {
    role: 'tool',
    tool_call_id: toolCallId,
    content: JSON.stringify(geminiResponse.response || {}),
  };
}

/**
 * 将 OpenAI 格式的消息转换为 Gemini 格式的内容
 *
 * 支持 user、assistant、tool 三种角色的消息。
 * tool 角色的消息会被转换为包含 functionResponse 的 GeminiContent。
 *
 * @param openaiMessage - OpenAI 格式的消息
 * @returns Gemini 格式的内容
 *
 * @example
 * ```ts
 * // Assistant 消息
 * const gemini = openAIMessageToGeminiContent({ role: 'assistant', content: 'Hello' });
 * // => { role: 'model', parts: [{ text: 'Hello' }] }
 *
 * // Tool 消息
 * const gemini = openAIMessageToGeminiContent({
 *   role: 'tool', tool_call_id: 'call_123', content: '{"temp":25}'
 * });
 * // => { role: 'user', parts: [{ functionResponse: { name: 'call_123', response: { temp: 25 } } }] }
 * ```
 */
export function openAIMessageToGeminiContent(
  openaiMessage: OpenAIMessage,
): GeminiContent {
  const parts: GeminiContentPart[] = [];

  // 处理文本内容（tool 角色的 content 是 JSON 响应，不在这里处理）
  if (openaiMessage.content && openaiMessage.role !== 'tool') {
    parts.push({ text: openaiMessage.content });
  }

  // 处理工具调用
  if (openaiMessage.tool_calls) {
    for (const toolCall of openaiMessage.tool_calls) {
      parts.push({
        functionCall: openAIToolCallToGemini(toolCall),
      });
    }
  }

  // 处理工具响应
  if (openaiMessage.role === 'tool' && openaiMessage.tool_call_id) {
    let response: Record<string, unknown> = {};
    try {
      if (openaiMessage.content) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const parsed = JSON.parse(openaiMessage.content);
        if (typeof parsed === 'object' && parsed !== null) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          response = parsed as Record<string, unknown>;
        }
      }
    } catch {
      response = { text: openaiMessage.content };
    }

    parts.push({
      functionResponse: {
        name: openaiMessage.tool_call_id,
        response,
      },
    });
  }

  // 确定角色
  const role = openaiMessage.role === 'assistant' ? 'model' : 'user';

  return { role, parts };
}

/**
 * 将 Gemini 格式的工具定义转换为 OpenAI 格式
 *
 * 支持两种 Gemini 工具格式：
 * 1. functionDeclarations 数组格式
 * 2. 单个 name/description 格式
 *
 * @param geminiTool - Gemini 格式的工具定义
 * @returns OpenAI 格式的工具定义数组
 *
 * @example
 * ```ts
 * const openaiTools = geminiToolToOpenAI({
 *   functionDeclarations: [{ name: 'get_weather', description: 'Get weather' }]
 * });
 * // => [{ type: 'function', function: { name: 'get_weather', description: 'Get weather' } }]
 * ```
 */
export function geminiToolToOpenAI(
  geminiTool: GeminiToolDefinition,
): OpenAIToolDefinition[] {
  const tools: OpenAIToolDefinition[] = [];

  // 处理 functionDeclarations 数组
  if (geminiTool.functionDeclarations) {
    for (const decl of geminiTool.functionDeclarations) {
      tools.push({
        type: 'function',
        function: {
          name: decl.name,
          description: decl.description,
          parameters: decl.parameters,
        },
      });
    }
  }
  // 处理单个工具定义
  else if (geminiTool.name) {
    tools.push({
      type: 'function',
      function: {
        name: geminiTool.name,
        description: geminiTool.description,
      },
    });
  }

  return tools;
}

/**
 * 将 OpenAI 格式的工具定义转换为 Gemini 格式
 *
 * @param openaiTools - OpenAI 格式的工具定义数组
 * @returns Gemini 格式的工具定义，包含 functionDeclarations 数组
 *
 * @example
 * ```ts
 * const geminiTool = openAIToolToGemini([
 *   { type: 'function', function: { name: 'get_weather', description: 'Get weather' } }
 * ]);
 * // => { functionDeclarations: [{ name: 'get_weather', description: 'Get weather' }] }
 * ```
 */
export function openAIToolToGemini(
  openaiTools: OpenAIToolDefinition[],
): GeminiToolDefinition {
  if (!openaiTools || openaiTools.length === 0) {
    return { functionDeclarations: [] };
  }

  return {
    functionDeclarations: openaiTools.map((tool) => ({
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    })),
  };
}

/**
 * 将 Gemini 格式的内容数组转换为 OpenAI 格式的消息数组
 *
 * 内部维护 toolCallIdMap 以确保 functionCall 和对应的 functionResponse
 * 使用相同的 tool_call_id。
 *
 * @param geminiContents - Gemini 格式的内容数组
 * @returns OpenAI 格式的消息数组
 *
 * @example
 * ```ts
 * const messages = geminiContentsToOpenAIMessages([
 *   { role: 'user', parts: [{ text: 'Hello' }] },
 *   { role: 'model', parts: [{ functionCall: { name: 'get_weather', args: {} } }] },
 * ]);
 * ```
 */
export function geminiContentsToOpenAIMessages(
  geminiContents: GeminiContent[],
): OpenAIMessage[] {
  const messages: OpenAIMessage[] = [];
  // 用于跟踪 functionCall 和 functionResponse 之间的 ID 映射
  const toolCallIdMap = new Map<string, string>();

  for (const content of geminiContents) {
    const role = content.role === 'model' ? 'assistant' : 'user';

    for (const part of content.parts) {
      if (part.text) {
        messages.push({
          role,
          content: part.text,
        });
      } else if (part.functionCall) {
        const toolCallId = generateToolCallId();
        toolCallIdMap.set(part.functionCall.name, toolCallId);

        messages.push({
          role: 'assistant',
          tool_calls: [
            geminiFunctionCallToOpenAI(part.functionCall, toolCallId),
          ],
        });
      } else if (part.functionResponse) {
        const toolCallId =
          toolCallIdMap.get(part.functionResponse.name) ||
          part.functionResponse.name;

        messages.push(
          geminiFunctionResponseToOpenAIMessage(
            part.functionResponse,
            toolCallId,
          ),
        );
      }
    }
  }

  return messages;
}

/**
 * 将 OpenAI 格式的响应转换为 Gemini 格式的内容部分数组
 *
 * @param openaiResponse - OpenAI 格式的响应（包含 content、tool_calls 和 reasoning）
 * @returns Gemini 格式的内容部分数组
 *
 * @example
 * ```ts
 * const parts = openAIResponseToGeminiParts({
 *   reasoning: 'Let me think about this...',
 *   content: 'The weather is sunny',
 *   tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{}' } }]
 * });
 * // => [{ text: 'Let me think about this...', thought: true }, { text: 'The weather is sunny' }, { functionCall: { name: 'get_weather', args: {} } }]
 * ```
 */
export function openAIResponseToGeminiParts(openaiResponse: {
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
  reasoning?: string | null;
}): GeminiContentPart[] {
  const parts: GeminiContentPart[] = [];

  // 处理思考过程（reasoning）
  if (openaiResponse.reasoning) {
    parts.push({ text: openaiResponse.reasoning, thought: true });
  }

  if (openaiResponse.content) {
    parts.push({ text: openaiResponse.content });
  }

  if (openaiResponse.tool_calls) {
    for (const toolCall of openaiResponse.tool_calls) {
      parts.push({
        functionCall: openAIToolCallToGemini(toolCall),
      });
    }
  }

  return parts;
}

// ==================== 工具类 ====================

/**
 * Function Call 转译器
 *
 * 提供状态化的转译功能，跟踪工具调用 ID 映射。
 * 适用于需要在多次转译之间保持 ID 一致性的场景。
 *
 * @example
 * ```ts
 * const translator = new FunctionCallTranslator();
 *
 * // Gemini -> OpenAI（记录 ID 映射）
 * const openai = translator.translateFunctionCall({ name: 'get_weather', args: {} });
 *
 * // 通过函数名获取对应的 tool_call_id
 * const id = translator.getToolCallId('get_weather');
 *
 * // 通过 tool_call_id 获取对应的函数名
 * const name = translator.getFunctionName(openai.id);
 *
 * // 清除映射
 * translator.clearMappings();
 * ```
 */
export class FunctionCallTranslator {
  /** Gemini function name -> OpenAI tool_call_id */
  private toolCallIdMap = new Map<string, string>();
  /** OpenAI tool_call_id -> Gemini function name */
  private reverseIdMap = new Map<string, string>();

  /**
   * 清除所有 ID 映射
   *
   * 在新一轮对话开始时调用，避免旧的 ID 映射干扰。
   */
  clearMappings(): void {
    this.toolCallIdMap.clear();
    this.reverseIdMap.clear();
  }

  /**
   * 获取当前映射的数量（用于调试）
   */
  get mappingCount(): number {
    return this.toolCallIdMap.size;
  }

  /**
   * 将 Gemini 函数调用转换为 OpenAI 工具调用
   *
   * 转换过程中会自动记录 ID 映射，后续可通过
   * {@link getToolCallId} 和 {@link getFunctionName} 查询。
   *
   * @param geminiCall - Gemini 格式的函数调用
   * @returns OpenAI 格式的工具调用
   * @throws 当 geminiCall.name 为空时抛出错误
   */
  translateFunctionCall(geminiCall: GeminiFunctionCall): OpenAIToolCall {
    const id = generateToolCallId();
    this.toolCallIdMap.set(geminiCall.name, id);
    this.reverseIdMap.set(id, geminiCall.name);
    return geminiFunctionCallToOpenAI(geminiCall, id);
  }

  /**
   * 将 OpenAI 工具调用转换为 Gemini 函数调用
   *
   * 转换过程中会自动记录 ID 映射。
   *
   * @param openaiCall - OpenAI 格式的工具调用
   * @returns Gemini 格式的函数调用
   * @throws 当 arguments 不是有效的 JSON 时抛出错误
   */
  translateToolCall(openaiCall: OpenAIToolCall): GeminiFunctionCall {
    this.toolCallIdMap.set(openaiCall.function.name, openaiCall.id);
    this.reverseIdMap.set(openaiCall.id, openaiCall.function.name);
    return openAIToolCallToGemini(openaiCall);
  }

  /**
   * 根据函数名获取对应的 OpenAI tool_call_id
   *
   * @param functionName - Gemini 函数名
   * @returns 对应的 tool_call_id，如果不存在则返回 undefined
   */
  getToolCallId(functionName: string): string | undefined {
    return this.toolCallIdMap.get(functionName);
  }

  /**
   * 根据 OpenAI tool_call_id 获取对应的 Gemini 函数名
   *
   * @param toolCallId - OpenAI tool_call_id
   * @returns 对应的函数名，如果不存在则返回 undefined
   */
  getFunctionName(toolCallId: string): string | undefined {
    return this.reverseIdMap.get(toolCallId);
  }

  /**
   * 将 Gemini 内容转换为 OpenAI 消息
   *
   * 会自动将 functionCall 部分转换为 tool_calls，并记录 ID 映射。
   *
   * @param geminiContent - Gemini 格式的内容
   * @returns OpenAI 格式的消息
   */
  translateGeminiContentToOpenAI(geminiContent: GeminiContent): OpenAIMessage {
    const parts: GeminiContentPart[] = [];
    const toolCalls: OpenAIToolCall[] = [];

    for (const part of geminiContent.parts) {
      if (part.functionCall) {
        toolCalls.push(this.translateFunctionCall(part.functionCall));
      } else {
        parts.push(part);
      }
    }

    const message: OpenAIMessage = {
      role: geminiContent.role === 'model' ? 'assistant' : 'user',
    };

    if (parts.length > 0 && parts[0].text) {
      message.content = parts[0].text;
    }

    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }

    return message;
  }

  /**
   * 将 OpenAI 消息转换为 Gemini 内容
   *
   * 支持 user、assistant、tool 三种角色。
   * tool 角色消息会利用已记录的 ID 映射还原函数名。
   *
   * @param openaiMessage - OpenAI 格式的消息
   * @returns Gemini 格式的内容
   */
  translateOpenAIMessageToGemini(openaiMessage: OpenAIMessage): GeminiContent {
    const parts: GeminiContentPart[] = [];

    // tool 角色的 content 是 JSON 响应，不在这里处理
    if (openaiMessage.content && openaiMessage.role !== 'tool') {
      parts.push({ text: openaiMessage.content });
    }

    if (openaiMessage.tool_calls) {
      for (const toolCall of openaiMessage.tool_calls) {
        parts.push({
          functionCall: this.translateToolCall(toolCall),
        });
      }
    }

    if (openaiMessage.role === 'tool' && openaiMessage.tool_call_id) {
      const functionName =
        this.getFunctionName(openaiMessage.tool_call_id) ||
        openaiMessage.tool_call_id;

      let response: Record<string, unknown> = {};
      try {
        if (openaiMessage.content) {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          response = JSON.parse(openaiMessage.content);
        }
      } catch {
        response = { text: openaiMessage.content };
      }

      parts.push({
        functionResponse: {
          name: functionName,
          response,
        },
      });
    }

    return {
      role: openaiMessage.role === 'assistant' ? 'model' : 'user',
      parts,
    };
  }
}
