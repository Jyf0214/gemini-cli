# Gemini CLI 核心实现研究报告

## 1. ContentGenerator 实现模式

### 1.1 接口定义 (ContentGenerator)
```typescript
// 位置: /workspaces/gemini-cli/packages/core/src/core/contentGenerator.ts

interface ContentGenerator {
  // 单次生成内容
  generateContent(
    request: GenerateContentParameters,
    userPromptId: string,
    role: LlmRole,
  ): Promise<GenerateContentResponse>;

  // 流式生成内容（关键方法）
  generateContentStream(
    request: GenerateContentParameters,
    userPromptId: string,
    role: LlmRole,
  ): Promise<AsyncGenerator<GenerateContentResponse>>;

  // 计算token数
  countTokens(request: CountTokensParameters): Promise<CountTokensResponse>;

  // 生成嵌入
  embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse>;

  // 用户信息
  userTier?: UserTierId;
  userTierName?: string;
  paidTier?: GeminiUserTier;
}
```

### 1.2 其他ContentGenerator实现

#### A. FakeContentGenerator (模拟实现)
**文件**: /workspaces/gemini-cli/packages/core/src/core/fakeContentGenerator.ts

**特点**:
- 从文件读取预录制的响应 (newline-delimited JSON)
- 用于测试和演示
- 支持所有4个方法

**关键方法**:
```typescript
class FakeContentGenerator implements ContentGenerator {
  private callCounter = 0;

  static async fromFile(filePath: string): Promise<FakeContentGenerator> {
    // 读取NDJSON格式的响应文件
    const fileContent = await promises.readFile(filePath, 'utf-8');
    const responses = fileContent
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as FakeResponse);
    return new FakeContentGenerator(responses);
  }

  private getNextResponse<M extends FakeResponse['method']>(
    method: M,
    request: unknown
  ): R {
    // 按顺序返回预录制的响应，验证方法匹配
    const response = this.responses[this.callCounter++];
    if (response.method !== method) {
      throw new Error(`Unexpected response type...`);
    }
    return response.response as R;
  }

  async generateContentStream(
    request: GenerateContentParameters,
    _userPromptId: string,
    role: LlmRole,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const responses = this.getNextResponse('generateContentStream', request);
    async function* stream() {
      for (const response of responses) {
        yield Object.setPrototypeOf(
          response,
          GenerateContentResponse.prototype,
        );
      }
    }
    return stream();
  }
}
```

**FakeResponse类型**:
```typescript
type FakeResponse =
  | { method: 'generateContent'; response: GenerateContentResponse }
  | { method: 'generateContentStream'; response: GenerateContentResponse[] }
  | { method: 'countTokens'; response: CountTokensResponse }
  | { method: 'embedContent'; response: EmbedContentResponse };
```

#### B. LoggingContentGenerator (装饰器模式)
**文件**: /workspaces/gemini-cli/packages/core/src/core/loggingContentGenerator.ts

**特点**:
- 包装另一个ContentGenerator
- 添加详细的日志和遥测功能
- 计算和估计上下文使用情况
- 处理错误和流式响应

**关键特性**:
```typescript
class LoggingContentGenerator implements ContentGenerator {
  constructor(
    private readonly wrapped: ContentGenerator,
    private readonly config: Config,
  ) {}

  async generateContentStream(
    req: GenerateContentParameters,
    userPromptId: string,
    role: LlmRole,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    // 在追踪span中运行
    return runInDevTraceSpan(
      {
        operation: GeminiCliOperation.LLMCall,
        logPrompts: this.config.getTelemetryLogPromptsEnabled(),
        attributes: { /* telemetry attributes */ },
      },
      async ({ metadata: spanMetadata }) => {
        spanMetadata.input = req.contents;

        const startTime = Date.now();
        const serverDetails = this._getEndpointUrl(req, 'generateContentStream');
        
        this.logApiRequest(/* ... */);

        let stream: AsyncGenerator<GenerateContentResponse>;
        try {
          stream = await this.wrapped.generateContentStream(req, userPromptId, role);
        } catch (error) {
          // 记录错误
          this._logApiError(/* ... */);
          throw error;
        }

        // 关键：流式包装器用于在流式传输时记录
        return this.loggingStreamWrapper(
          req,
          stream,
          startTime,
          userPromptId,
          role,
          spanMetadata,
        );
      },
    );
  }

  // 流式包装器：在流式传输时聚合和记录响应
  private async *loggingStreamWrapper(
    req: GenerateContentParameters,
    stream: AsyncGenerator<GenerateContentResponse>,
    startTime: number,
    userPromptId: string,
    role: LlmRole,
    spanMetadata: SpanMetadata,
  ): AsyncGenerator<GenerateContentResponse> {
    const responses: GenerateContentResponse[] = [];
    let lastUsageMetadata: GenerateContentResponseUsageMetadata | undefined;
    const serverDetails = this._getEndpointUrl(req, 'generateContentStream');
    const requestContents: Content[] = toContents(req.contents);

    try {
      for await (const response of stream) {
        responses.push(response);
        if (response.usageMetadata) {
          lastUsageMetadata = response.usageMetadata;
        }
        yield response;  // 传递给下游消费者
      }

      // 流完成后记录完整的响应
      const durationMs = Date.now() - startTime;
      this._logApiResponse(
        requestContents,
        durationMs,
        responses[0]?.modelVersion || req.model,
        userPromptId,
        role,
        responses[0]?.responseId,
        responses.flatMap((response) => response.candidates || []),
        lastUsageMetadata,
        JSON.stringify(responses.map(/* ... */)),
        req.config,
        serverDetails,
      );
    } catch (error) {
      spanMetadata.error = error;
      this._logApiError(/* ... */);
      throw error;
    }
  }
}
```

**重要方法**:
```typescript
// 估计上下文使用情况，区分MCP工具和普通工具
function estimateContextBreakdown(
  contents: Content[],
  config?: GenerateContentConfig,
): ContextBreakdown {
  // 返回: { system_instructions, tool_definitions, history, tool_calls, mcp_servers }
}
```

#### C. RecordingContentGenerator (代理 + 记录)
**文件**: /workspaces/gemini-cli/packages/core/src/core/recordingContentGenerator.ts

**特点**:
- 包装真实的ContentGenerator
- 将所有响应记录到文件中
- 输出格式与FakeContentGenerator兼容 (NDJSON)

**实现**:
```typescript
class RecordingContentGenerator implements ContentGenerator {
  constructor(
    private readonly realGenerator: ContentGenerator,
    private readonly filePath: string,
  ) {}

  async generateContentStream(
    request: GenerateContentParameters,
    userPromptId: string,
    role: LlmRole,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const recordedResponse: FakeResponse = {
      method: 'generateContentStream',
      response: [],
    };

    const realResponses = await this.realGenerator.generateContentStream(
      request,
      userPromptId,
      role,
    );

    async function* stream(filePath: string) {
      for await (const response of realResponses) {
        // 只记录感兴趣的部分
        (recordedResponse.response as GenerateContentResponse[]).push({
          candidates: response.candidates,
          usageMetadata: response.usageMetadata,
        } as GenerateContentResponse);
        yield response;
      }
      // 流完成时写入文件
      appendFileSync(filePath, `${safeJsonStringify(recordedResponse)}\n`);
    }

    return Promise.resolve(stream(this.filePath));
  }
}
```

#### D. CodeAssistServer (内部Google认证实现)
**文件**: /workspaces/gemini-cli/packages/core/src/code_assist/server.ts

**特点**:
- 用于Google账户认证
- 处理AI学分和配额
- 流式处理带有仪器

---

## 2. Tool/Function 定义和调用处理

### 2.1 Tool 定义结构

**文件**: /workspaces/gemini-cli/packages/core/src/tools/definitions/types.ts

```typescript
// 工具定义接口
interface ToolDefinition {
  /** 工具的基础声明 */
  base: FunctionDeclaration;

  /** 特定模型的覆盖 */
  overrides?: (modelId: string) => Partial<FunctionDeclaration> | undefined;
}

// 核心工具集合
interface CoreToolSet {
  read_file: FunctionDeclaration;
  write_file: FunctionDeclaration;
  grep_search: FunctionDeclaration;
  grep_search_ripgrep: FunctionDeclaration;
  glob: FunctionDeclaration;
  list_directory: FunctionDeclaration;
  run_shell_command: (
    enableInteractiveShell: boolean,
    enableEfficiency: boolean,
    enableToolSandboxing: boolean,
  ) => FunctionDeclaration;
  replace: FunctionDeclaration;
  google_web_search: FunctionDeclaration;
  web_fetch: FunctionDeclaration;
  read_many_files: FunctionDeclaration;
  save_memory: FunctionDeclaration;
  write_todos: FunctionDeclaration;
  get_internal_docs: FunctionDeclaration;
  ask_user: FunctionDeclaration;
  enter_plan_mode: FunctionDeclaration;
  exit_plan_mode: () => FunctionDeclaration;
  activate_skill: (skillNames: string[]) => FunctionDeclaration;
  update_topic?: FunctionDeclaration;
}
```

### 2.2 Function Call 处理流程

**位置**: /workspaces/gemini-cli/packages/core/src/scheduler/tool-executor.ts

```typescript
// 工具调用结构
interface ToolExecutionContext {
  call: ToolCall;                    // 工具调用请求
  signal: AbortSignal;               // 中止信号
  outputUpdateHandler?: (
    callId: string,
    output: ToolLiveOutput
  ) => void;                         // 实时输出处理
  onUpdateToolCall: (updatedCall: ToolCall) => void; // 状态更新回调
}

// 工具执行步骤
async execute(context: ToolExecutionContext): Promise<CompletedToolCall> {
  const { call, signal, outputUpdateHandler, onUpdateToolCall } = context;
  const { request } = call;
  const toolName = request.name;
  const callId = request.callId;

  // 1. 验证工具和调用信息
  if (!('tool' in call) || !call.tool || !('invocation' in call)) {
    throw new Error(`Cannot execute tool call ${callId}: ...`);
  }
  const { tool, invocation } = call;

  // 2. 设置实时输出处理
  const liveOutputCallback = tool.canUpdateOutput && outputUpdateHandler
    ? (outputChunk: ToolLiveOutput) => {
        outputUpdateHandler(callId, outputChunk);
      }
    : undefined;

  // 3. 执行工具
  const toolResult: ToolResult = await executeToolWithHooks(
    invocation,
    toolName,
    signal,
    tool,
    liveOutputCallback,
    { /* config */ },
    this.config,
    request.originalRequestName,
    true,
  );

  // 4. 处理结果 - 创建FunctionResponse
  if (signal.aborted) {
    completedToolCall = await this.createCancelledResult(call, reason, toolResult);
  } else if (toolResult.error === undefined) {
    completedToolCall = await this.createSuccessResult(call, toolResult);
  } else {
    completedToolCall = this.createErrorResult(call, error, errorType);
  }

  return completedToolCall;
}
```

### 2.3 FunctionResponse 生成

**位置**: /workspaces/gemini-cli/packages/core/src/scheduler/scheduler.ts

```typescript
// 错误响应示例
const createErrorResponse = (
  request: ToolCallRequestInfo,
  error: Error,
  errorType: ToolErrorType | undefined,
): ToolCallResponseInfo => ({
  callId: request.callId,
  error,
  responseParts: [
    {
      functionResponse: {
        id: request.callId,
        name: request.originalRequestName ?? request.name,
        response: { error: error.message },
      },
    },
  ],
  resultDisplay: error.message,
  errorType,
  contentLength: error.message.length,
});
```

### 2.4 Function Call 在 Part 中的表现

**位置**: 在 GenerateContentResponse.candidates[0].content.parts 中

```typescript
// 包含function call的part
type Part = {
  functionCall?: {
    name: string;
    args: Record<string, unknown>;
  };
  // 或
  functionResponse?: {
    name: string;
    response: Record<string, unknown>;
  };
};

// 检测function calls
const functionCalls = resp.functionCalls ?? [];  // 或从parts中提取
for (const fnCall of functionCalls) {
  const event = this.handlePendingFunctionCall(fnCall, traceId);
  // 发送ToolCallRequest事件
}
```

---

## 3. 流式响应处理

### 3.1 基础流式模式

**AsyncGenerator 返回类型**:
```typescript
// ContentGenerator.generateContentStream 返回这个
async generateContentStream(
  request: GenerateContentParameters,
  userPromptId: string,
  role: LlmRole,
): Promise<AsyncGenerator<GenerateContentResponse>>
```

### 3.2 核心流式处理示例

**位置**: /workspaces/gemini-cli/packages/core/src/code_assist/server.ts

```typescript
async generateContentStream(
  req: GenerateContentParameters,
  userPromptId: string,
  role: LlmRole,
): Promise<AsyncGenerator<GenerateContentResponse>> {
  // 获取响应流
  const responses = await this.requestStreamingPost<CaGenerateContentResponse>(
    'streamGenerateContent',
    toGenerateContentRequest(/* ... */),
    req.config?.abortSignal,
  );

  const streamingLatency: StreamingLatency = {};
  const start = Date.now();
  let isFirst = true;

  // 返回async generator函数
  return (async function* (
    server: CodeAssistServer,
  ): AsyncGenerator<GenerateContentResponse> {
    let totalConsumed = 0;
    let lastRemaining = 0;

    // 迭代底层响应流
    for await (const response of responses) {
      // 记录延迟指标
      if (isFirst) {
        streamingLatency.firstMessageLatency = formatProtoJsonDuration(
          Date.now() - start,
        );
        isFirst = false;
      }

      streamingLatency.totalLatency = formatProtoJsonDuration(
        Date.now() - start,
      );

      // 转换响应格式
      const translatedResponse = fromGenerateContentResponse(response);

      // 处理学分
      if (response.consumedCredits) {
        for (const credit of response.consumedCredits) {
          if (credit.creditType === G1_CREDIT_TYPE && credit.creditAmount) {
            totalConsumed += parseInt(credit.creditAmount, 10) || 0;
          }
        }
      }

      // 产生转换后的响应
      yield translatedResponse;
    }

    // 流完成后的清理工作
    if (totalConsumed > 0 && server.config) {
      logBillingEvent(
        server.config,
        new CreditsUsedEvent(req.model ?? 'unknown', totalConsumed, lastRemaining),
      );
    }
  })(this);  // 立即执行generator工厂函数，传入this
}
```

### 3.3 LoggingContentGenerator 中的流式包装

**位置**: /workspaces/gemini-cli/packages/core/src/core/loggingContentGenerator.ts

```typescript
// 关键：流式包装器模式
private async *loggingStreamWrapper(
  req: GenerateContentParameters,
  stream: AsyncGenerator<GenerateContentResponse>,
  startTime: number,
  userPromptId: string,
  role: LlmRole,
  spanMetadata: SpanMetadata,
): AsyncGenerator<GenerateContentResponse> {
  const responses: GenerateContentResponse[] = [];  // 聚合所有响应
  let lastUsageMetadata: GenerateContentResponseUsageMetadata | undefined;

  try {
    for await (const response of stream) {
      responses.push(response);  // 聚合
      if (response.usageMetadata) {
        lastUsageMetadata = response.usageMetadata;
      }
      yield response;  // 向下传递
    }

    // 流完成时的日志记录
    const durationMs = Date.now() - startTime;
    this._logApiResponse(
      requestContents,
      durationMs,
      responses[0]?.modelVersion || req.model,
      userPromptId,
      role,
      responses[0]?.responseId,
      responses.flatMap((response) => response.candidates || []),
      lastUsageMetadata,
      JSON.stringify(responses.map(r => ({
        candidates: r.candidates,
        usageMetadata: r.usageMetadata,
        responseId: r.responseId,
        modelVersion: r.modelVersion,
        promptFeedback: r.promptFeedback,
      }))),
      req.config,
      serverDetails,
    );
    
    spanMetadata.output = responses.map(
      (response) => response.candidates?.[0]?.content ?? null,
    );
    if (lastUsageMetadata) {
      spanMetadata.attributes[GEN_AI_USAGE_INPUT_TOKENS] =
        lastUsageMetadata.promptTokenCount ?? 0;
      spanMetadata.attributes[GEN_AI_USAGE_OUTPUT_TOKENS] =
        lastUsageMetadata.candidatesTokenCount ?? 0;
    }
  } catch (error) {
    spanMetadata.error = error;
    const durationMs = Date.now() - startTime;
    this._logApiError(durationMs, error, /* ... */);
    throw error;
  }
}
```

### 3.4 Turn 中的流式事件处理

**位置**: /workspaces/gemini-cli/packages/core/src/core/turn.ts

```typescript
// 消费流式响应
const responseStream = await this.chat.sendMessageStream(
  modelConfigKey,
  req,
  this.prompt_id,
  signal,
  role,
  displayContent,
);

for await (const streamEvent of responseStream) {
  if (signal?.aborted) {
    yield { type: GeminiEventType.UserCancelled };
    return;
  }

  // 处理retry事件
  if (streamEvent.type === 'retry') {
    yield { type: GeminiEventType.Retry };
    continue;
  }

  // 处理agent执行stopped/blocked
  if (streamEvent.type === 'agent_execution_stopped') {
    yield {
      type: GeminiEventType.AgentExecutionStopped,
      value: { reason: streamEvent.reason },
    };
    return;
  }

  if (streamEvent.type === 'agent_execution_blocked') {
    yield {
      type: GeminiEventType.AgentExecutionBlocked,
      value: { reason: streamEvent.reason },
    };
    continue;
  }

  // 处理内容和工具调用
  const resp = streamEvent.value;
  if (!resp) continue;

  this.debugResponses.push(resp);
  const traceId = resp.responseId;

  // 提取parts并处理不同类型
  const parts = resp.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part.thought) {
      const thought = parseThought(part.text ?? '');
      yield {
        type: GeminiEventType.Thought,
        value: thought,
        traceId,
      };
    }
  }

  // 文本内容
  const text = getResponseText(resp);
  if (text) {
    yield { type: GeminiEventType.Content, value: text, traceId };
  }

  // Function calls (工具调用请求)
  const functionCalls = resp.functionCalls ?? [];
  for (const fnCall of functionCalls) {
    const event = this.handlePendingFunctionCall(fnCall, traceId);
    if (event) {
      yield event;
    }
  }
}
```

### 3.5 GeminiChat 中的流式处理

**位置**: /workspaces/gemini-cli/packages/core/src/core/geminiChat.ts

```typescript
// 处理流式响应的核心逻辑
private async *processStreamResponse(
  model: string,
  streamResponse: AsyncGenerator<GenerateContentResponse>,
  originalRequest: GenerateContentParameters,
): AsyncGenerator<GenerateContentResponse> {
  const modelResponseParts: Part[] = [];

  let hasToolCall = false;
  let hasThoughts = false;
  let finishReason: FinishReason | undefined;

  for await (const chunk of streamResponse) {
    // 提取finish reason
    const candidateWithReason = chunk?.candidates?.find(
      (candidate) => candidate.finishReason,
    );
    if (candidateWithReason) {
      finishReason = candidateWithReason.finishReason as FinishReason;
    }

    // 验证响应有效性
    if (isValidResponse(chunk)) {
      const content = chunk.candidates?.[0]?.content;
      if (content?.parts) {
        // 检测thoughts
        if (content.parts.some((part) => part.thought)) {
          hasThoughts = true;
          this.recordThoughtFromContent(content);
        }
        // 检测工具调用
        if (content.parts.some((part) => part.functionCall)) {
          hasToolCall = true;
        }

        // 聚合parts（排除thoughts）
        modelResponseParts.push(
          ...content.parts.filter((part) => !part.thought),
        );
      }
    }

    // 记录token使用情况
    if (chunk.usageMetadata) {
      this.chatRecordingService.recordMessageTokens(chunk.usageMetadata);
      if (chunk.usageMetadata.promptTokenCount !== undefined) {
        this.lastPromptTokenCount = chunk.usageMetadata.promptTokenCount;
      }
    }

    // 钩子处理
    const hookSystem = this.context.config.getHookSystem();
    if (originalRequest && chunk && hookSystem) {
      const hookResult = await hookSystem.fireAfterModelEvent(
        originalRequest,
        chunk,
      );

      if (hookResult.stopped) {
        throw new AgentExecutionStoppedError(
          hookResult.reason || 'Agent execution stopped by hook',
        );
      }
    }

    yield chunk;
  }
}
```

---

## 4. 建议的实现方向

### 4.1 自定义 ContentGenerator 的关键点

1. **实现基础接口**:
   - 必须实现所有4个方法
   - `generateContentStream` 返回 `Promise<AsyncGenerator<GenerateContentResponse>>`

2. **AsyncGenerator 最佳实践**:
   ```typescript
   // 方式1: 普通async generator函数
   async *processStream(): AsyncGenerator<Type> {
     for await (const item of sourceStream) {
       // 处理item
       yield processedItem;
     }
   }

   // 方式2: 返回IIFE generator函数
   return (async function* (context): AsyncGenerator<Type> {
     for await (const item of sourceStream) {
       yield processedItem;
     }
   })(this);  // 立即执行，传入上下文
   ```

3. **装饰器模式优势**:
   - 可以包装已有的ContentGenerator
   - 在请求前/后添加逻辑
   - 可以转换请求或响应

4. **错误处理**:
   ```typescript
   try {
     for await (const response of stream) {
       yield response;
     }
   } catch (error) {
     // 记录/转换错误
     this._logError(error);
     throw error;  // 重新抛出给下游消费者
   }
   ```

5. **流式聚合模式**:
   ```typescript
   const responses: GenerateContentResponse[] = [];
   for await (const response of stream) {
     responses.push(response);  // 聚合用于最终日志
     yield response;            // 即时传递给消费者
   }
   // 流结束后，responses包含所有响应
   ```

### 4.2 Function Call 处理的关键点

1. **请求端**:
   - model通过config.tools参数接收FunctionDeclaration
   - model返回GenerateContentResponse，其中candidates[0].content.parts包含functionCall

2. **响应处理**:
   ```typescript
   const functionCalls = resp.functionCalls ?? [];
   for (const fnCall of functionCalls) {
     // fnCall.name: 工具名
     // fnCall.args: 工具参数
   }
   ```

3. **Function Response 格式**:
   ```typescript
   // 在下一轮请求的contents中添加functionResponse
   {
     role: 'user',
     parts: [
       {
         functionResponse: {
           name: toolName,
           response: { /* 工具执行结果 */ }
         }
       }
    ]
   }
   ```

### 4.3 流式处理架构建议

1. **分层设计**:
   - 底层: ContentGenerator (原始API)
   - 中层: LoggingContentGenerator (仪器化)
   - 上层: 业务逻辑 (turn.ts, scheduler等)

2. **事件驱动**:
   - 流式响应转化为事件 (ServerGeminiContentEvent等)
   - 便于处理和并发

3. **聚合模式**:
   - 立即yield给下游消费者 (低延迟)
   - 同时聚合用于最终统计和日志

4. **错误恢复**:
   - 在流式处理中支持重试 (MID_STREAM_RETRY)
   - 记录重试事件供UI显示

### 4.4 代码组织建议

```
core/
├── contentGenerator.ts       # 接口定义
├── fakeContentGenerator.ts   # 测试实现
├── loggingContentGenerator.ts # 装饰器实现
├── recordingContentGenerator.ts # 录制实现
├── baseLlmClient.ts         # 工具类方法
└── geminiChat.ts            # 高级API

scheduler/
├── types.ts                 # ToolCall等类型
├── tool-executor.ts         # 工具执行
└── scheduler.ts             # 工具调度

tools/
├── definitions/
│   ├── types.ts             # ToolDefinition等
│   ├── coreTools.ts         # 核心工具集
│   └── model-family-sets/   # 模型特定的工具集
└── tool-error.ts            # 错误处理
```

---

## 5. 参考实现文件路径汇总

| 功能 | 文件路径 | 关键类/函数 |
|------|--------|-----------|
| ContentGenerator 接口 | core/contentGenerator.ts | ContentGenerator interface |
| 模拟实现 | core/fakeContentGenerator.ts | FakeContentGenerator |
| 装饰器实现 | core/loggingContentGenerator.ts | LoggingContentGenerator |
| 录制实现 | core/recordingContentGenerator.ts | RecordingContentGenerator |
| 代码助理实现 | code_assist/server.ts | CodeAssistServer |
| 工具定义 | tools/definitions/types.ts | ToolDefinition, CoreToolSet |
| 工具执行 | scheduler/tool-executor.ts | ToolExecutor |
| Turn处理 | core/turn.ts | Turn class |
| GeminiChat实现 | core/geminiChat.ts | GeminiChat class |

