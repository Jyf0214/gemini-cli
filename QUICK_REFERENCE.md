# Gemini CLI 快速参考指南

## 核心文件地图

### ContentGenerator 实现
| 文件 | 类型 | 用途 | 行数 |
|------|------|------|------|
| `core/contentGenerator.ts` | 接口 + 工厂 | 定义接口、创建实例 | 303 |
| `core/fakeContentGenerator.ts` | 实现 | 模拟测试用 | 127 |
| `core/loggingContentGenerator.ts` | 装饰器 | 日志和遥测 | 609 |
| `core/recordingContentGenerator.ts` | 装饰器 | 记录响应到文件 | 125 |
| `code_assist/server.ts` | 实现 | Google认证实现 | 574 |

### Tool 和 Function Calling
| 文件 | 类型 | 用途 |
|------|------|------|
| `tools/definitions/types.ts` | 类型定义 | ToolDefinition, CoreToolSet |
| `tools/definitions/coreTools.ts` | 导出 | 工具集合、名称常量 |
| `tools/definitions/base-declarations.ts` | 工具定义 | 工具参数和声明 |
| `scheduler/types.ts` | 类型定义 | ToolCall, ToolCallRequest 等 |
| `scheduler/tool-executor.ts` | 执行器 | 工具执行和结果处理 |

### 流式处理
| 文件 | 类型 | 关键部分 |
|------|------|----------|
| `core/geminiChat.ts` | 核心 | processStreamResponse, sendMessageStream |
| `core/turn.ts` | 事件处理 | 流式事件转化 |
| `agent/agent-session.ts` | 会话 | stream(), sendStream() |
| `code_assist/server.ts` | 实现 | generateContentStream 的IIFE模式 |

---

## 快速实现清单

### 创建自定义 ContentGenerator

```typescript
// 1. 实现接口
class MyContentGenerator implements ContentGenerator {
  // 2. 实现4个必需方法
  async generateContent(
    request: GenerateContentParameters,
    userPromptId: string,
    role: LlmRole,
  ): Promise<GenerateContentResponse> {
    // 实现
  }

  async generateContentStream(
    request: GenerateContentParameters,
    userPromptId: string,
    role: LlmRole,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    // 关键：返回 AsyncGenerator
    return (async function* (self): AsyncGenerator<GenerateContentResponse> {
      // 迭代数据源
      for await (const chunk of dataSource) {
        yield chunk;
      }
    })(this);  // IIFE 立即执行
  }

  async countTokens(request: CountTokensParameters): Promise<CountTokensResponse> {
    // 实现
  }

  async embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse> {
    // 实现
  }

  // 3. 可选属性
  userTier?: UserTierId;
  userTierName?: string;
  paidTier?: GeminiUserTier;
}
```

### 创建装饰器 ContentGenerator

```typescript
class MyDecoratorGenerator implements ContentGenerator {
  constructor(
    private readonly wrapped: ContentGenerator,
    private readonly customConfig: MyConfig,
  ) {}

  async generateContentStream(
    request: GenerateContentParameters,
    userPromptId: string,
    role: LlmRole,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    // 1. 获取底层流
    const stream = await this.wrapped.generateContentStream(request, userPromptId, role);

    // 2. 包装和转换
    return this.wrapStream(stream);
  }

  private async *wrapStream(
    stream: AsyncGenerator<GenerateContentResponse>
  ): AsyncGenerator<GenerateContentResponse> {
    try {
      for await (const response of stream) {
        // 处理/转换
        const processed = this.process(response);
        yield processed;
      }
      // 流完成后的清理
      this.cleanup();
    } catch (error) {
      this.handleError(error);
      throw error;
    }
  }

  // 代理其他方法
  get userTier(): UserTierId | undefined {
    return this.wrapped.userTier;
  }

  async generateContent(...args) {
    return this.wrapped.generateContent(...args);
  }

  async countTokens(...args) {
    return this.wrapped.countTokens(...args);
  }

  async embedContent(...args) {
    return this.wrapped.embedContent(...args);
  }
}
```

---

## 常用代码片段

### 1. 检测 Function Call

```typescript
const functionCalls = resp.functionCalls ?? [];
for (const fnCall of functionCalls) {
  console.log('Tool:', fnCall.name);
  console.log('Args:', fnCall.args);
}
```

### 2. 检测 Function Response

```typescript
if (part.functionResponse) {
  const { name, response } = part.functionResponse;
  console.log(`Tool ${name} returned:`, response);
}
```

### 3. 流式处理（基础）

```typescript
const stream = await contentGen.generateContentStream(request, promptId, role);
for await (const response of stream) {
  // 处理每个chunk
  const text = getResponseText(response);
  if (text) console.log(text);
}
```

### 4. 流式处理（聚合）

```typescript
const responses: GenerateContentResponse[] = [];
const stream = await contentGen.generateContentStream(request, promptId, role);

for await (const response of stream) {
  responses.push(response);
  // 立即输出
  const text = getResponseText(response);
  if (text) process.stdout.write(text);
}

// 流完成后
console.log('Total responses:', responses.length);
const totalTokens = responses[responses.length - 1]?.usageMetadata?.totalTokenCount;
console.log('Total tokens:', totalTokens);
```

### 5. 错误处理

```typescript
try {
  for await (const response of stream) {
    yield response;
  }
} catch (error) {
  if (isAbortError(error)) {
    console.log('Stream aborted');
  } else {
    console.error('Stream error:', error);
  }
  throw error;  // 重新抛出
}
```

---

## 关键概念

### GenerateContentResponse 结构

```typescript
{
  candidates: [{
    content: {
      role: "model",
      parts: [
        { text: "..." },                    // 文本内容
        { thought: "..." },                 // 思维过程
        { functionCall: { name, args } },   // 工具调用请求
        { functionResponse: { name, response } },  // 工具响应
      ]
    },
    finishReason: "STOP" | "MAX_TOKENS" | ...
  }],
  usageMetadata: {
    promptTokenCount: number,
    candidatesTokenCount: number,
  }
}
```

### AsyncGenerator 模式

```typescript
// 模式1: 简单包装
async *wrap(source) {
  for await (const item of source) {
    yield item;
  }
}

// 模式2: IIFE（保存 this 上下文）
return (async function* (self) {
  for await (const item of source) {
    yield item;
  }
  await self.cleanup();  // 可以访问 self (即 this)
})(this);
```

### 装饰器链

```
输入 -> LoggingContentGenerator(日志层)
      -> RecordingContentGenerator(记录层)
      -> GoogleGenAI或CodeAssistServer(API层)
      <- 返回经过三层处理的响应
```

---

## 测试快速启动

### 创建测试响应文件

```bash
# NDJSON 格式，每行一个响应
{
  "method": "generateContentStream",
  "response": [
    {"candidates": [{"content": {"parts": [{"text": "chunk1"}], "role": "model"}}]},
    {"candidates": [{"content": {"parts": [{"text": "chunk2"}], "role": "model"}}]}
  ]
}
```

### 使用 FakeContentGenerator

```typescript
const fake = await FakeContentGenerator.fromFile('test-responses.ndjson');
// 使用 fake 代替真实的 ContentGenerator
```

### 记录响应

```typescript
const recording = new RecordingContentGenerator(realGen, 'output.ndjson');
// 使用 recording，所有响应会被记录到文件中
```

---

## 常见错误和解决方案

### 错误1: 忘记 yield 导致无响应

```typescript
// 错误
async *stream() {
  for await (const item of source) {
    // 忘记 yield
  }
}

// 正确
async *stream() {
  for await (const item of source) {
    yield item;  // 必须 yield
  }
}
```

### 错误2: 在流完成前尝试访问全部响应

```typescript
// 问题
const allResponses = [];
const stream = contentGen.generateContentStream(...);
for await (const response of stream) {
  // 此时 allResponses 还在构建中
}
// 只有这里 allResponses 才是完整的
```

### 错误3: ContentGenerator 方法没有正确代理

```typescript
// 问题（装饰器）
class Wrapper implements ContentGenerator {
  // 忘记实现 countTokens 等方法
}

// 解决
class Wrapper implements ContentGenerator {
  async generateContent(...args) { return this.wrapped.generateContent(...args); }
  async generateContentStream(...args) { return this.wrapped.generateContentStream(...args); }
  async countTokens(...args) { return this.wrapped.countTokens(...args); }
  async embedContent(...args) { return this.wrapped.embedContent(...args); }
  get userTier() { return this.wrapped.userTier; }
  // 等等...
}
```

### 错误4: 函数调用响应格式错误

```typescript
// 错误
{ functionResponse: "tool output" }  // 字符串

// 正确
{ functionResponse: { name: "tool_name", response: { /* 结构化数据 */ } } }
```

---

## 性能优化建议

1. **立即 yield**：不要等待全部处理完再输出
2. **流式聚合**：只保存必要的元数据而不是完整响应
3. **及时中止**：使用 AbortSignal 支持取消
4. **分离关注点**：每层只做一件事（日志、转换、记录等）

---

## 资源链接

- 完整研究报告: `RESEARCH_SUMMARY.md`
- 实现模式详解: `IMPLEMENTATION_PATTERNS.md`
- 源代码位置: `/workspaces/gemini-cli/packages/core/src/`

---

## 字典

| 术语 | 含义 |
|------|------|
| ContentGenerator | 内容生成接口，所有实现的基础 |
| FunctionCall | 模型请求执行工具 |
| FunctionResponse | 工具执行结果返回给模型 |
| AsyncGenerator | TypeScript 异步生成器 |
| StreamEvent | 流式事件，包括CHUNK、RETRY等 |
| MCP | Model Context Protocol，外部工具协议 |
| NDJSON | Newline-Delimited JSON，记录格式 |
| IIFE | Immediately Invoked Function Expression |
| Decorator Pattern | 装饰器模式，用于添加功能 |

