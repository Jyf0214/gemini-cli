# Gemini CLI 实现模式详细指南

## 一、ContentGenerator 模式对比

### 1. 直接实现 vs 装饰器模式

```
直接实现（FakeContentGenerator）：
┌─────────────────────────────┐
│  FakeContentGenerator       │
│  ├─ generateContent()       │
│  ├─ generateContentStream() │
│  ├─ countTokens()          │
│  └─ embedContent()         │
└─────────────────────────────┘

装饰器链（生产环境）：
┌──────────────────────────────────────────┐
│  LoggingContentGenerator (日志层)        │
│  └─ wrapped: ContentGenerator            │
│     ┌────────────────────────────┐       │
│     │  RecordingContentGenerator │       │
│     │  └─ realGenerator          │       │
│     │     ┌──────────────────┐   │       │
│     │     │  GoogleGenAI或   │   │       │
│     │     │  CodeAssistServer│   │       │
│     │     └──────────────────┘   │       │
│     └────────────────────────────┘       │
└──────────────────────────────────────────┘
```

### 2. 装饰器模式的关键实现细节

**目的**: 分离关注点（日志、记录、错误处理）
**使用者**: 生产代码中的 createContentGenerator()

```typescript
// 实际应用示例（来自 contentGenerator.ts）
export async function createContentGenerator(
  config: ContentGeneratorConfig,
  gcConfig: Config,
  sessionId?: string,
): Promise<ContentGenerator> {
  const generator = await (async () => {
    if (gcConfig.fakeResponses) {
      // 测试路径
      const fakeGenerator = await FakeContentGenerator.fromFile(
        gcConfig.fakeResponses,
      );
      // 即使是fake，也要包装日志
      return new LoggingContentGenerator(fakeGenerator, gcConfig);
    }

    // 生产路径
    const googleGenAI = new GoogleGenAI({ /* config */ });
    return new LoggingContentGenerator(googleGenAI.models, gcConfig);
  })();

  // 可选：添加记录层
  if (gcConfig.recordResponses) {
    return new RecordingContentGenerator(generator, gcConfig.recordResponses);
  }

  return generator;
}
```

---

## 二、流式处理的三层架构

### 层级1：原始流获取（ContentGenerator 实现）

```typescript
// CodeAssistServer.generateContentStream() 示例
async generateContentStream(
  req: GenerateContentParameters,
  userPromptId: string,
  role: LlmRole,
): Promise<AsyncGenerator<GenerateContentResponse>> {
  // 第1步：获取底层HTTP流
  const responses = await this.requestStreamingPost<CaGenerateContentResponse>(
    'streamGenerateContent',
    toGenerateContentRequest(/* ... */),
    req.config?.abortSignal,
  );

  // 第2步：包装成async generator函数
  return (async function* (
    server: CodeAssistServer,
  ): AsyncGenerator<GenerateContentResponse> {
    for await (const response of responses) {
      // 第3步：数据转换/处理（学分计算、指标记录等）
      const translatedResponse = fromGenerateContentResponse(response);
      
      // 处理学分
      if (response.consumedCredits) {
        totalConsumed += computeCredits(response.consumedCredits);
      }

      // 第4步：产出处理后的响应
      yield translatedResponse;
    }

    // 第5步：流结束时的清理
    if (totalConsumed > 0) {
      logBillingEvent(/* ... */);
    }
  })(this);  // IIFE立即执行
}
```

**关键点**：
- 返回 IIFE (immediately invoked function expression)
- 这样可以捕获 `this` 上下文
- 允许在流结束后执行清理代码

### 层级2：日志和聚合（LoggingContentGenerator）

```typescript
// LoggingContentGenerator.loggingStreamWrapper() 示例
private async *loggingStreamWrapper(
  req: GenerateContentParameters,
  stream: AsyncGenerator<GenerateContentResponse>,  // 来自layer 1
  startTime: number,
  userPromptId: string,
  role: LlmRole,
  spanMetadata: SpanMetadata,
): AsyncGenerator<GenerateContentResponse> {
  const responses: GenerateContentResponse[] = [];  // 聚合存储

  try {
    for await (const response of stream) {
      // 第1步：聚合
      responses.push(response);
      
      // 第2步：追踪最后的使用元数据
      if (response.usageMetadata) {
        lastUsageMetadata = response.usageMetadata;
      }

      // 第3步：立即传递给下游（低延迟）
      yield response;
    }

    // 第4步：流完成后统一日志
    const durationMs = Date.now() - startTime;
    this._logApiResponse(
      requestContents,
      durationMs,
      responses[0]?.modelVersion || req.model,
      userPromptId,
      role,
      responses[0]?.responseId,
      responses.flatMap((response) => response.candidates || []),  // 聚合所有候选
      lastUsageMetadata,
      JSON.stringify(responses),  // 完整响应序列
      req.config,
      serverDetails,
    );

  } catch (error) {
    spanMetadata.error = error;
    this._logApiError(durationMs, error, /* ... */);
    throw error;  // 重新抛出
  }
}
```

**特点**:
- 同时支持实时流和事后聚合
- 所有响应保存在内存中（有大小限制考虑）
- 错误立即抛出，不吞噬

### 层级3：业务逻辑处理（Turn.handleResponse）

```typescript
// Turn 中的流式处理
for await (const streamEvent of responseStream) {
  if (signal?.aborted) {
    yield { type: GeminiEventType.UserCancelled };
    return;
  }

  // 处理不同事件类型
  if (streamEvent.type === 'retry') {
    yield { type: GeminiEventType.Retry };
    continue;
  }

  const resp = streamEvent.value;
  if (!resp) continue;

  // 提取不同类型的 parts
  const parts = resp.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part.thought) {
      // 处理thinking
      yield { type: GeminiEventType.Thought, value: thought };
    } else if (part.functionCall) {
      // 处理工具调用请求
      yield { type: GeminiEventType.ToolCallRequest, value: toolCall };
    } else if (part.text) {
      // 处理文本内容
      yield { type: GeminiEventType.Content, value: text };
    }
  }
}
```

---

## 三、Function Call 完整流程

### 请求端（Model生成调用）

```
1. 模型配置阶段
   config.tools = [
     {
       functionDeclarations: [
         {
           name: "read_file",
           description: "Reads a file from the filesystem",
           parameters: {
             properties: {
               path: { type: "string" }
             },
             required: ["path"]
           }
         }
       ]
     }
   ]

2. 发送请求
   ContentGenerator.generateContentStream({
     model: "gemini-2.0-flash",
     contents: [/* 对话历史 */],
     config: { tools: [/* 工具定义 */] }
   })

3. 模型响应（在流式chunk中）
   GenerateContentResponse {
     candidates: [{
       content: {
         role: "model",
         parts: [
           { functionCall: {
               name: "read_file",
               args: { path: "/etc/hosts" }
             }
           }
         ]
       },
       finishReason: "STOP"
     }]
   }
```

### 响应端（执行工具）

```
1. 检测 functionCall
   const functionCalls = resp.functionCalls ?? [];
   for (const fnCall of functionCalls) {
     const toolCallRequest = {
       callId: generateId(),
       name: fnCall.name,
       args: fnCall.args
     };
     yield { type: GeminiEventType.ToolCallRequest, value: toolCallRequest };
   }

2. 执行工具（由 Scheduler 处理）
   const result = await executor.execute({
     call: { request: toolCallRequest, /* ... */ },
     signal: abortSignal,
     onUpdateToolCall: updateCallback
   });

3. 生成 functionResponse
   const functionResponse = {
     name: fnCall.name,
     response: {
       // 工具执行结果
       content: "file contents here",
       exitCode: 0
     }
   };

4. 下一轮请求包含 functionResponse
   new_request.contents = [
     ...previous_contents,
     {
       role: "user",
       parts: [{
         functionResponse: functionResponse
       }]
     }
   ];
```

### Function Call vs Function Response 的关键区别

```typescript
// Function Call：模型请求工具调用
part.functionCall = {
  name: string;
  args: Record<string, unknown>;
};

// Function Response：工具执行结果返回给模型
part.functionResponse = {
  name: string;
  response: Record<string, unknown>;
};

// 在 Part 中的表现
type Part = 
  | { text?: string }
  | { functionCall?: FunctionCall }
  | { functionResponse?: FunctionResponse }
  | { thought?: string }
  | /* ... 其他类型 */;
```

---

## 四、MCP 工具的特殊处理

**MCP（Model Context Protocol）工具在系统中的地位**：
- 由外部 MCP 服务器提供
- 需要与本地工具区分对待（用于遥测和上下文计算）

```typescript
// 检测是否为MCP工具（来自loggingContentGenerator.ts）
import { isMcpToolName } from '../tools/mcp-tool.js';

function estimateContextBreakdown(
  contents: Content[],
  config?: GenerateContentConfig,
): ContextBreakdown {
  let mcpServers = 0;
  let toolCalls: Record<string, number> = {};

  // 遍历工具调用和响应
  for (const content of contents) {
    for (const part of content.parts || []) {
      if (part.functionCall) {
        const name = part.functionCall.name || 'unknown';
        const tokens = estimateTokenCountSync([part]);
        
        if (isMcpToolName(name)) {
          // MCP工具计入mcpServers
          mcpServers += tokens;
        } else {
          // 本地工具计入toolCalls
          toolCalls[name] = (toolCalls[name] || 0) + tokens;
        }
      } else if (part.functionResponse) {
        const name = part.functionResponse.name || 'unknown';
        const tokens = estimateTokenCountSync([part]);
        
        if (isMcpToolName(name)) {
          mcpServers += tokens;
        } else {
          toolCalls[name] = (toolCalls[name] || 0) + tokens;
        }
      }
    }
  }

  return {
    system_instructions: /* ... */,
    tool_definitions: /* ... */,
    history: /* ... */,
    tool_calls: toolCalls,
    mcp_servers: mcpServers,  // 分离计数
  };
}
```

---

## 五、错误处理和恢复

### 1. 流式处理中的错误恢复

```typescript
// 位置: geminiChat.ts
// MID_STREAM_RETRY 配置
const MID_STREAM_RETRY_OPTIONS: MidStreamRetryOptions = {
  maxAttempts: 4,              // 1 initial + 3 retries
  initialDelayMs: 1000,
  useExponentialBackoff: true,
};

// 使用方式
private async *processStreamWithRetry(
  model: string,
  request: GenerateContentParameters,
  role: LlmRole,
): AsyncGenerator<StreamEvent> {
  let attempt = 0;
  let lastError: Error | undefined;

  while (attempt < MID_STREAM_RETRY_OPTIONS.maxAttempts) {
    try {
      const stream = await this.contentGenerator.generateContentStream(
        request,
        this.prompt_id,
        role,
      );

      for await (const response of stream) {
        yield { type: StreamEventType.CHUNK, value: response };
      }
      return;  // 成功完成
    } catch (error) {
      lastError = error as Error;
      attempt++;

      if (attempt < MID_STREAM_RETRY_OPTIONS.maxAttempts) {
        // 计算退避延迟
        const delay = MID_STREAM_RETRY_OPTIONS.initialDelayMs *
          (MID_STREAM_RETRY_OPTIONS.useExponentialBackoff
            ? Math.pow(2, attempt - 1)
            : attempt);

        yield { type: StreamEventType.RETRY };
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}
```

### 2. 错误分类和日志

```typescript
// 来自 LoggingContentGenerator
private _logApiError(
  durationMs: number,
  error: unknown,
  model: string,
  prompt_id: string,
  requestContents: Content[],
  role: LlmRole,
  generationConfig?: GenerateContentConfig,
  serverDetails?: ServerDetails,
): void {
  // 忽略abort错误（用户取消）
  if (isAbortError(error)) {
    return;
  }

  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorType = getErrorType(error);  // 分类错误类型

  // 提取HTTP状态码（如果有）
  const statusCode = isStructuredError(error)
    ? (error as StructuredError).status
    : undefined;

  logApiError(
    this.config,
    new ApiErrorEvent(
      model,
      errorMessage,
      durationMs,
      { prompt_id, contents: requestContents, generate_content_config: generationConfig },
      this.config.getContentGeneratorConfig()?.authType,
      errorType,
      statusCode,
      role,
    ),
  );
}
```

---

## 六、常见实现模式参考代码

### 模式1：基础流式包装

```typescript
async *basicStreamWrapper(
  sourceStream: AsyncGenerator<SourceType>
): AsyncGenerator<OutputType> {
  for await (const item of sourceStream) {
    const processed = this.transform(item);
    yield processed;
  }
}
```

### 模式2：包含错误处理的流式包装

```typescript
async *robustStreamWrapper(
  sourceStream: AsyncGenerator<SourceType>
): AsyncGenerator<OutputType> {
  try {
    for await (const item of sourceStream) {
      yield this.transform(item);
    }
  } catch (error) {
    this.handleError(error);
    throw error;
  }
}
```

### 模式3：包含聚合和事后处理

```typescript
async *aggregatingStreamWrapper(
  sourceStream: AsyncGenerator<SourceType>
): AsyncGenerator<OutputType> {
  const items: SourceType[] = [];

  try {
    for await (const item of sourceStream) {
      items.push(item);
      yield this.transform(item);
    }
    // 流完成后的聚合处理
    this.processAggregate(items);
  } catch (error) {
    this.handleError(error);
    throw error;
  }
}
```

### 模式4：IIFE 生成器（用于捕获上下文）

```typescript
return (async function* (context: ThisType): AsyncGenerator<OutputType> {
  let state = context.initialState;

  for await (const item of sourceStream) {
    state = await context.updateState(state, item);
    yield { value: item, state };
  }

  // 流结束时访问 context
  await context.cleanup();
})(this);
```

---

## 七、调试和测试

### 1. 使用 FakeContentGenerator 进行测试

```typescript
// 创建测试响应文件
const fakeResponses: FakeResponse[] = [
  {
    method: 'generateContent',
    response: {
      candidates: [
        {
          content: {
            parts: [{ text: 'Hello, world!' }],
            role: 'model'
          }
        }
      ]
    }
  },
  {
    method: 'generateContentStream',
    response: [
      {
        candidates: [
          { content: { parts: [{ text: 'Chunk 1' }], role: 'model' } }
        ]
      },
      {
        candidates: [
          { content: { parts: [{ text: 'Chunk 2' }], role: 'model' } }
        ]
      }
    ]
  }
];

// 写入 NDJSON 文件
const ndjson = fakeResponses.map(r => JSON.stringify(r)).join('\n');
fs.writeFileSync('test-responses.ndjson', ndjson);

// 使用
const fakeGenerator = await FakeContentGenerator.fromFile('test-responses.ndjson');
const config = { fakeResponses: 'test-responses.ndjson' };
```

### 2. 记录实际响应

```typescript
// 启用 recordResponses 选项
const config = {
  recordResponses: '/tmp/recorded-responses.ndjson'
};

// 运行会话...

// 后续可以用 --fake-responses 选项回放
```

---

## 八、性能考虑

### 1. 流式聚合的内存影响

```typescript
// 问题：如果响应非常大，responses 数组可能消耗大量内存
const responses: GenerateContentResponse[] = [];
for await (const response of stream) {
  responses.push(response);  // 所有响应都在内存中
  yield response;
}
// 在大型流中可能有问题

// 解决方案1：只保存必要的信息
interface MinimalResponse {
  candidateCount: number;
  tokenCount: number;
  // 不保存完整的内容
}

// 解决方案2：使用WeakRef或相对路径
// 注：通常不需要这么激进，响应通常不会太大
```

### 2. 延迟优化

```typescript
// 及时yield以减少延迟
for await (const response of stream) {
  responses.push(response);
  yield response;  // 立即传递，不等待处理完成
}

// 而不是
const allResponses = [];
for await (const response of stream) {
  allResponses.push(response);
}
for (const response of allResponses) {
  yield response;  // 这样会延迟第一个响应
}
```

