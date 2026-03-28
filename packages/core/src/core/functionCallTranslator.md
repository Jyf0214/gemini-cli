# Function Call 转译器使用文档

## 1. 功能概述

`functionCallTranslator.ts` 是一个 OpenAI 和 Gemini 格式之间的 Function
Call 转译层。主要功能包括：

- **格式转换**：在 OpenAI 和 Gemini 格式之间转换函数调用（function
  call）、函数响应（function response）和工具定义（tool definition）
- **消息历史转换**：支持完整的消息历史格式转换
- **状态化转译**：通过 `FunctionCallTranslator`
  类维护工具调用 ID 映射，确保调用和响应的正确关联
- **ID 管理**：自动生成和管理工具调用 ID，确保 OpenAI 格式要求的 ID 字段正确映射

## 2. OpenAI 和 Gemini 格式差异说明

### 2.1 函数调用格式差异

| 特性          | OpenAI 格式                                               | Gemini 格式      |
| ------------- | --------------------------------------------------------- | ---------------- |
| **结构**      | `{ id, type: 'function', function: { name, arguments } }` | `{ name, args }` |
| **参数格式**  | JSON 字符串                                               | 对象             |
| **ID 字段**   | 必需，字符串                                              | 无               |
| **Type 字段** | 固定为 `'function'`                                       | 无               |

### 2.2 函数响应格式差异

| 特性         | OpenAI 格式         | Gemini 格式                  |
| ------------ | ------------------- | ---------------------------- |
| **消息角色** | `'tool'`            | 作为 `functionResponse` 部分 |
| **ID 关联**  | `tool_call_id` 字段 | 通过 `name` 字段关联         |
| **响应内容** | JSON 字符串         | 对象                         |

### 2.3 工具定义格式差异

| 特性         | OpenAI 格式                                                         | Gemini 格式                                  |
| ------------ | ------------------------------------------------------------------- | -------------------------------------------- |
| **结构**     | `{ type: 'function', function: { name, description, parameters } }` | `{ functionDeclarations: [...] }` 或单个定义 |
| **嵌套层级** | 两层嵌套                                                            | 可直接定义或数组形式                         |
| **批量定义** | 数组形式                                                            | 数组在 `functionDeclarations` 内             |

### 2.4 消息格式差异

| 特性         | OpenAI 格式                                   | Gemini 格式             |
| ------------ | --------------------------------------------- | ----------------------- |
| **角色**     | `'user' \| 'assistant' \| 'system' \| 'tool'` | `'user' \| 'model'`     |
| **内容结构** | `content` 字符串                              | `parts` 数组            |
| **工具调用** | `tool_calls` 数组                             | `functionCall` 部分     |
| **工具响应** | 独立的 `tool` 角色消息                        | `functionResponse` 部分 |

## 3. 使用示例

### 3.1 基础转换函数

```typescript
import {
  geminiFunctionCallToOpenAI,
  openAIToolCallToGemini,
  geminiToolToOpenAI,
  openAIToolToGemini,
} from './functionCallTranslator.js';

// Gemini -> OpenAI 函数调用转换
const geminiCall = {
  name: 'get_weather',
  args: { location: 'Beijing', unit: 'celsius' },
};
const openAICall = geminiFunctionCallToOpenAI(geminiCall);
// 结果: { id: 'call_...', type: 'function', function: { name: 'get_weather', arguments: '{"location":"Beijing","unit":"celsius"}' } }

// OpenAI -> Gemini 函数调用转换
const openAICall = {
  id: 'call_123',
  type: 'function' as const,
  function: {
    name: 'get_weather',
    arguments: '{"location":"Beijing"}',
  },
};
const geminiCall = openAIToolCallToGemini(openAICall);
// 结果: { name: 'get_weather', args: { location: 'Beijing' } }
```

### 3.2 工具定义转换

```typescript
// Gemini -> OpenAI 工具定义
const geminiTool = {
  functionDeclarations: [
    {
      name: 'get_weather',
      description: '获取天气信息',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: '城市名称' },
        },
      },
    },
  ],
};
const openAITools = geminiToolToOpenAI(geminiTool);

// OpenAI -> Gemini 工具定义
const openAITools = [
  {
    type: 'function' as const,
    function: {
      name: 'get_weather',
      description: '获取天气信息',
      parameters: {
        /* ... */
      },
    },
  },
];
const geminiTool = openAIToolToGemini(openAITools);
```

### 3.3 消息历史转换

```typescript
import {
  geminiContentsToOpenAIMessages,
  openAIMessageToGeminiContent,
} from './functionCallTranslator.js';

// Gemini -> OpenAI 消息数组
const geminiContents = [
  {
    role: 'user',
    parts: [{ text: '北京今天天气怎么样？' }],
  },
  {
    role: 'model',
    parts: [
      {
        functionCall: {
          name: 'get_weather',
          args: { location: 'Beijing' },
        },
      },
    ],
  },
  {
    role: 'user',
    parts: [
      {
        functionResponse: {
          name: 'get_weather',
          response: { temperature: 25, condition: '晴' },
        },
      },
    ],
  },
];
const openAIMessages = geminiContentsToOpenAIMessages(geminiContents);
```

### 3.4 使用 FunctionCallTranslator 类（推荐）

```typescript
import { FunctionCallTranslator } from './functionCallTranslator.js';

const translator = new FunctionCallTranslator();

// 转换 Gemini 函数调用（自动管理 ID）
const geminiCall = { name: 'search', args: { query: 'TypeScript' } };
const openAICall = translator.translateFunctionCall(geminiCall);
console.log(openAICall.id); // 自动生成的 ID

// 获取函数名对应的 ID
const id = translator.getToolCallId('search');

// 转换完整内容
const geminiContent = {
  role: 'model' as const,
  parts: [
    { text: '我来帮你搜索' },
    { functionCall: { name: 'search', args: { query: 'test' } } },
  ],
};
const openAIMessage = translator.translateGeminiContentToOpenAI(geminiContent);

// 清除映射（在新的会话开始时调用）
translator.clearMappings();
```

### 3.5 响应转换

```typescript
import { openAIResponseToGeminiParts } from './functionCallTranslator.js';

// OpenAI 响应 -> Gemini 部分
const openAIResponse = {
  content: '这是回答',
  tool_calls: [
    {
      id: 'call_123',
      type: 'function' as const,
      function: {
        name: 'calculate',
        arguments: '{"x":5,"y":3}',
      },
    },
  ],
};
const geminiParts = openAIResponseToGeminiParts(openAIResponse);
```

## 4. API 参考

### 4.1 类型定义

#### GeminiFunctionCall

```typescript
interface GeminiFunctionCall {
  name: string;
  args: Record<string, unknown>;
}
```

#### GeminiFunctionResponse

```typescript
interface GeminiFunctionResponse {
  name: string;
  response: Record<string, unknown>;
}
```

#### GeminiToolDefinition

```typescript
interface GeminiToolDefinition {
  functionDeclarations?: Array<{
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  }>;
  name?: string;
  description?: string;
}
```

#### OpenAIToolCall

```typescript
interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON 字符串
  };
}
```

#### OpenAIToolDefinition

```typescript
interface OpenAIToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}
```

#### OpenAIMessage

```typescript
interface OpenAIMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}
```

#### GeminiContentPart

```typescript
interface GeminiContentPart {
  text?: string;
  functionCall?: GeminiFunctionCall;
  functionResponse?: GeminiFunctionResponse;
}
```

#### GeminiContent

```typescript
interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiContentPart[];
}
```

### 4.2 函数

#### geminiFunctionCallToOpenAI

```typescript
function geminiFunctionCallToOpenAI(
  geminiCall: GeminiFunctionCall,
  id?: string,
): OpenAIToolCall;
```

将 Gemini 格式的函数调用转换为 OpenAI 格式。如果未提供 `id`，会自动生成。

#### openAIToolCallToGemini

```typescript
function openAIToolCallToGemini(openaiCall: OpenAIToolCall): GeminiFunctionCall;
```

将 OpenAI 格式的工具调用转换为 Gemini 格式。如果 `arguments`
不是有效 JSON，会抛出错误。

#### geminiFunctionResponseToOpenAIMessage

```typescript
function geminiFunctionResponseToOpenAIMessage(
  geminiResponse: GeminiFunctionResponse,
  toolCallId: string,
): OpenAIMessage;
```

将 Gemini 格式的函数响应转换为 OpenAI 格式的 `tool` 角色消息。

#### openAIMessageToGeminiContent

```typescript
function openAIMessageToGeminiContent(
  openaiMessage: OpenAIMessage,
): GeminiContent;
```

将 OpenAI 格式的消息转换为 Gemini 格式的内容。

#### geminiToolToOpenAI

```typescript
function geminiToolToOpenAI(
  geminiTool: GeminiToolDefinition,
): OpenAIToolDefinition[];
```

将 Gemini 格式的工具定义转换为 OpenAI 格式的工具定义数组。

#### openAIToolToGemini

```typescript
function openAIToolToGemini(
  openaiTools: OpenAIToolDefinition[],
): GeminiToolDefinition;
```

将 OpenAI 格式的工具定义数组转换为 Gemini 格式。

#### geminiContentsToOpenAIMessages

```typescript
function geminiContentsToOpenAIMessages(
  geminiContents: GeminiContent[],
): OpenAIMessage[];
```

将 Gemini 格式的内容数组转换为 OpenAI 格式的消息数组。自动处理 `functionCall` 和
`functionResponse` 之间的 ID 映射。

#### openAIResponseToGeminiParts

```typescript
function openAIResponseToGeminiParts(openaiResponse: {
  content?: string | null;
  tool_calls?: OpenAIToolCall[];
}): GeminiContentPart[];
```

将 OpenAI 格式的响应转换为 Gemini 格式的内容部分数组。

### 4.3 FunctionCallTranslator 类

#### 构造函数

```typescript
new FunctionCallTranslator();
```

#### 方法

##### clearMappings

```typescript
clearMappings(): void
```

清除所有工具调用 ID 映射。在新会话开始时调用。

##### translateFunctionCall

```typescript
translateFunctionCall(geminiCall: GeminiFunctionCall): OpenAIToolCall
```

将 Gemini 函数调用转换为 OpenAI 工具调用，并记录 ID 映射。

##### translateToolCall

```typescript
translateToolCall(openaiCall: OpenAIToolCall): GeminiFunctionCall
```

将 OpenAI 工具调用转换为 Gemini 函数调用，并记录 ID 映射。

##### getToolCallId

```typescript
getToolCallId(functionName: string): string | undefined
```

获取函数名对应的工具调用 ID。

##### getFunctionName

```typescript
getFunctionName(toolCallId: string): string | undefined
```

获取工具调用 ID 对应的函数名。

##### translateGeminiContentToOpenAI

```typescript
translateGeminiContentToOpenAI(geminiContent: GeminiContent): OpenAIMessage
```

将 Gemini 内容转换为 OpenAI 消息，自动处理函数调用。

##### translateOpenAIMessageToGemini

```typescript
translateOpenAIMessageToGemini(openaiMessage: OpenAIMessage): GeminiContent
```

将 OpenAI 消息转换为 Gemini 内容，自动处理工具响应的 ID 映射。

## 5. 注意事项

### 5.1 JSON 解析

- OpenAI 格式的 `arguments` 是 JSON 字符串，转换时会自动解析
- 如果 JSON 解析失败，`openAIToolCallToGemini` 会抛出错误
- 对于工具响应，如果内容不是有效 JSON，会将其包装为 `{ text: content }`

### 5.2 ID 映射管理

- `FunctionCallTranslator` 类维护双向映射：函数名 ↔ 工具调用 ID
- 建议在每个新会话开始时调用 `clearMappings()` 清除旧的映射
- 无状态函数（如 `geminiContentsToOpenAIMessages`）内部也会自动处理 ID 映射

### 5.3 角色转换

- OpenAI 的 `'system'` 角色在转换为 Gemini 格式时会变成 `'user'` 角色
- Gemini 的 `'model'` 角色对应 OpenAI 的 `'assistant'` 角色
- OpenAI 的 `'tool'` 角色在 Gemini 中表示为 `functionResponse` 部分

### 5.4 工具定义兼容性

- Gemini 支持两种工具定义形式：`functionDeclarations` 数组或单个定义
- 转换为 OpenAI 格式时，会统一转换为数组形式
- 单个 Gemini 工具定义转换时，只使用 `name` 和 `description`，不包含
  `parameters`

### 5.5 类型安全

- 所有接口都有明确的 TypeScript 类型定义
- 使用 `unknown` 类型处理动态参数，确保类型安全
- 建议在使用时进行适当的类型断言或类型守卫

### 5.6 性能考虑

- 无状态函数适合单次转换场景
- `FunctionCallTranslator` 类适合需要维护状态的连续对话场景
- ID 生成使用时间戳和随机数，确保唯一性

### 5.7 错误处理

- JSON 解析错误会被捕获并重新抛出，包含原始错误信息
- 对于非 JSON 格式的工具响应内容，会优雅降级为文本形式
- 建议在调用转换函数时使用 try-catch 处理可能的解析错误

### 5.8 使用建议

- 优先使用 `FunctionCallTranslator` 类进行连续对话的格式转换
- 对于简单的单次转换，可以使用无状态的工具函数
- 在处理 OpenAI 兼容端点（如 Deepseek、Qwen、Kimi 等）时，此模块特别有用
- 参考 `openaiContentGenerator.ts` 了解实际集成示例
