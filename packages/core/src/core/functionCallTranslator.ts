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
 */

// ==================== 类型定义 ====================

/**
 * Gemini 格式的函数调用
 */
export interface GeminiFunctionCall {
  name: string;
  args: Record<string, unknown>;
}

/**
 * Gemini 格式的函数响应
 */
export interface GeminiFunctionResponse {
  name: string;
  response: Record<string, unknown>;
}

/**
 * Gemini 格式的工具定义
 */
export interface GeminiToolDefinition {
  functionDeclarations?: Array<{
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  }>;
  name?: string;
  description?: string;
}

/**
 * OpenAI 格式的工具调用
 */
export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON 字符串
  };
}

/**
 * OpenAI 格式的工具定义
 */
export interface OpenAIToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

/**
 * OpenAI 格式的消息
 */
export interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

/**
 * Gemini 格式的内容部分
 */
export interface GeminiContentPart {
  text?: string;
  functionCall?: GeminiFunctionCall;
  functionResponse?: GeminiFunctionResponse;
}

/**
 * Gemini 格式的内容
 */
export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiContentPart[];
}

// ==================== 转译函数 ====================

/**
 * 生成唯一的工具调用 ID
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
 */
export function geminiFunctionCallToOpenAI(
  geminiCall: GeminiFunctionCall,
  id?: string,
): OpenAIToolCall {
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
 * @throws 如果 arguments 不是有效的 JSON
 */
export function openAIToolCallToGemini(
  openaiCall: OpenAIToolCall,
): GeminiFunctionCall {
  let args: Record<string, unknown> = {};

  try {
    if (openaiCall.function.arguments) {
      const parsed = JSON.parse(openaiCall.function.arguments);
      if (typeof parsed === 'object' && parsed !== null) {
        args = parsed as Record<string, unknown>;
      }
    }
  } catch (error) {
    throw new Error(
      `解析 OpenAI 工具调用参数失败: ${openaiCall.function.arguments}. 错误: ${error}`,
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
 * @returns OpenAI 格式的消息
 */
export function geminiFunctionResponseToOpenAIMessage(
  geminiResponse: GeminiFunctionResponse,
  toolCallId: string,
): OpenAIMessage {
  return {
    role: 'tool',
    tool_call_id: toolCallId,
    content: JSON.stringify(geminiResponse.response || {}),
  };
}

/**
 * 将 OpenAI 格式的消息转换为 Gemini 格式的内容
 *
 * @param openaiMessage - OpenAI 格式的消息
 * @returns Gemini 格式的内容
 */
export function openAIMessageToGeminiContent(
  openaiMessage: OpenAIMessage,
): GeminiContent {
  const parts: GeminiContentPart[] = [];

  // 处理文本内容
  if (openaiMessage.content) {
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
        const parsed = JSON.parse(openaiMessage.content);
        if (typeof parsed === 'object' && parsed !== null) {
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
 * @param geminiTool - Gemini 格式的工具定义
 * @returns OpenAI 格式的工具定义数组
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
 * @returns Gemini 格式的工具定义
 */
export function openAIToolToGemini(
  openaiTools: OpenAIToolDefinition[],
): GeminiToolDefinition {
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
 * @param geminiContents - Gemini 格式的内容数组
 * @returns OpenAI 格式的消息数组
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
          role: role as 'user' | 'assistant',
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
 * @param openaiResponse - OpenAI 格式的响应（包含 content 和 tool_calls）
 * @returns Gemini 格式的内容部分数组
 */
export function openAIResponseToGeminiParts(openaiResponse: {
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
}): GeminiContentPart[] {
  const parts: GeminiContentPart[] = [];

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
 * 提供状态化的转译功能，跟踪工具调用 ID 映射
 */
export class FunctionCallTranslator {
  // tool_call_id 映射：Gemini function name -> OpenAI tool_call_id
  private toolCallIdMap = new Map<string, string>();
  // 反向映射：OpenAI tool_call_id -> Gemini function name
  private reverseIdMap = new Map<string, string>();

  /**
   * 清除所有 ID 映射
   */
  clearMappings(): void {
    this.toolCallIdMap.clear();
    this.reverseIdMap.clear();
  }

  /**
   * 将 Gemini 函数调用转换为 OpenAI 工具调用
   */
  translateFunctionCall(geminiCall: GeminiFunctionCall): OpenAIToolCall {
    const id = generateToolCallId();
    this.toolCallIdMap.set(geminiCall.name, id);
    this.reverseIdMap.set(id, geminiCall.name);
    return geminiFunctionCallToOpenAI(geminiCall, id);
  }

  /**
   * 将 OpenAI 工具调用转换为 Gemini 函数调用
   */
  translateToolCall(openaiCall: OpenAIToolCall): GeminiFunctionCall {
    this.toolCallIdMap.set(openaiCall.function.name, openaiCall.id);
    this.reverseIdMap.set(openaiCall.id, openaiCall.function.name);
    return openAIToolCallToGemini(openaiCall);
  }

  /**
   * 获取工具调用对应的 ID
   */
  getToolCallId(functionName: string): string | undefined {
    return this.toolCallIdMap.get(functionName);
  }

  /**
   * 获取 ID 对应的函数名
   */
  getFunctionName(toolCallId: string): string | undefined {
    return this.reverseIdMap.get(toolCallId);
  }

  /**
   * 将 Gemini 内容转换为 OpenAI 消息
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
   */
  translateOpenAIMessageToGemini(openaiMessage: OpenAIMessage): GeminiContent {
    const parts: GeminiContentPart[] = [];

    if (openaiMessage.content) {
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
