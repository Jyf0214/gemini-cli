/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview 用于创建带有配置工具的浏览器代理定义的工厂。
 *
 * 当通过 delegate_to_agent 调用浏览器代理时，会调用此工厂。
 * 它创建 BrowserManager，连接隔离的 MCP 客户端，包装工具，
 * 并返回完全配置的 LocalAgentDefinition。
 *
 * 重要：MCP 工具仅在浏览器代理的隔离注册表中可用。
 * 它们不会在主代理的 ToolRegistry 中注册。
 */

import type { Config } from '../../config/config.js';
import type { LocalAgentDefinition } from '../types.js';
import type { MessageBus } from '../../confirmation-bus/message-bus.js';
import type { AnyDeclarativeTool } from '../../tools/tools.js';
import { BrowserManager } from './browserManager.js';
import { BROWSER_AGENT_NAME } from './browserAgentDefinition.js';
import { MCP_TOOL_PREFIX } from '../../tools/mcp-tool.js';
import {
  BrowserAgentDefinition,
  type BrowserTaskResultSchema,
} from './browserAgentDefinition.js';
import { createMcpDeclarativeTools } from './mcpToolWrapper.js';
import { createAnalyzeScreenshotTool } from './analyzeScreenshot.js';
import { injectAutomationOverlay } from './automationOverlay.js';
import { injectInputBlocker } from './inputBlocker.js';
import { debugLogger } from '../../utils/debugLogger.js';
import {
  PolicyDecision,
  PRIORITY_SUBAGENT_TOOL,
  type PolicyRule,
} from '../../policy/types.js';

/**
 * 创建带有配置的 MCP 工具的浏览器代理定义。
 *
 * 当通过 delegate_to_agent 调用浏览器代理时调用此函数。
 * MCP 客户端是新建的，工具被包装到代理的隔离注册表中 - 不会注册到主代理。
 *
 * @param config 运行时配置
 * @param messageBus 用于工具调用的消息总线
 * @param printOutput 可选的进度消息回调
 * @returns 包含 MCP 工具的完全配置的 LocalAgentDefinition
 */
export async function createBrowserAgentDefinition(
  config: Config,
  messageBus: MessageBus,
  printOutput?: (msg: string) => void,
): Promise<{
  definition: LocalAgentDefinition<typeof BrowserTaskResultSchema>;
  browserManager: BrowserManager;
}> {
  debugLogger.log('正在创建带有隔离 MCP 工具的浏览器代理定义...');

  // 获取或创建此会话模式/配置文件的浏览器管理器单例
  const browserManager = BrowserManager.getInstance(config);
  await browserManager.ensureConnection();

  if (printOutput) {
    printOutput('浏览器已连接，使用隔离的 MCP 客户端。');
  }

  // 确定输入阻止器是否应处于活动状态（非无头模式 + 启用）
  const shouldDisableInput = config.shouldDisableBrowserUserInput();
  // 如果不在无头模式下，注入自动化覆盖层和输入阻止器
  const browserConfig = config.getBrowserAgentConfig();
  if (!browserConfig?.customConfig?.headless) {
    if (printOutput) {
      printOutput('正在注入自动化覆盖层...');
    }
    await injectAutomationOverlay(browserManager);
    if (shouldDisableInput) {
      if (printOutput) {
        printOutput('正在注入输入阻止器...');
      }
      await injectInputBlocker(browserManager);
    }
  }

  // 从动态发现的 MCP 工具创建声明性工具
  // 这些工具分派到 browserManager 的隔离客户端
  const mcpTools = await createMcpDeclarativeTools(
    browserManager,
    messageBus,
    shouldDisableInput,
    browserConfig.customConfig.blockFileUploads,
  );
  const availableToolNames = mcpTools.map((t) => t.name);

  // 注册高优先级策略规则以防止 YOLO 模式覆盖的敏感操作
  const policyEngine = config.getPolicyEngine();

  if (policyEngine) {
    const existingRules = policyEngine.getRules();

    const restrictedTools = ['fill', 'fill_form'];

    // 当需要确认敏感操作时，对 upload_file 和 evaluate_script 进行 ASK_USER 确认
    if (browserConfig.customConfig.confirmSensitiveActions) {
      restrictedTools.push('upload_file', 'evaluate_script');
    }

    for (const toolName of restrictedTools) {
      const rule = generateAskUserRules(toolName);
      if (!existingRules.some((r) => isRuleEqual(r, rule))) {
        policyEngine.addRule(rule);
      }
    }

    // 在默认模式下减少只读工具的噪音
    const readOnlyTools = (await browserManager.getDiscoveredTools())
      .filter((t) => !!t.annotations?.readOnlyHint)
      .map((t) => t.name);
    const allowlistedReadonlyTools = ['take_snapshot', 'take_screenshot'];

    for (const toolName of [...readOnlyTools, ...allowlistedReadonlyTools]) {
      if (availableToolNames.includes(toolName)) {
        const rule = generateAllowRules(toolName);
        if (!existingRules.some((r) => isRuleEqual(r, rule))) {
          policyEngine.addRule(rule);
        }
      }
    }
  }

  function generateAskUserRules(toolName: string): PolicyRule {
    return {
      toolName: `${MCP_TOOL_PREFIX}${BROWSER_AGENT_NAME}_${toolName}`,
      decision: PolicyDecision.ASK_USER,
      priority: 999,
      source: '浏览器代理（敏感操作）',
      mcpName: BROWSER_AGENT_NAME,
    };
  }

  function generateAllowRules(toolName: string): PolicyRule {
    return {
      toolName: `${MCP_TOOL_PREFIX}${BROWSER_AGENT_NAME}_${toolName}`,
      decision: PolicyDecision.ALLOW,
      priority: PRIORITY_SUBAGENT_TOOL,
      source: '浏览器代理（只读）',
      mcpName: BROWSER_AGENT_NAME,
    };
  }

  // 检查策略规则在我们关心的所有属性上是否相同
  function isRuleEqual(rule1: PolicyRule, rule2: PolicyRule) {
    return (
      rule1.toolName === rule2.toolName &&
      rule1.decision === rule2.decision &&
      rule1.priority === rule2.priority &&
      rule1.mcpName === rule2.mcpName
    );
  }

  // 验证必需的语义工具是否可用
  const requiredSemanticTools = [
    'click',
    'fill',
    'navigate_page',
    'take_snapshot',
  ];
  const missingSemanticTools = requiredSemanticTools.filter(
    (t) => !availableToolNames.includes(t),
  );
  if (missingSemanticTools.length > 0) {
    debugLogger.warn(
      `语义工具缺失 (${missingSemanticTools.join(', ')}). ` +
        '某些浏览器交互可能无法正常工作。',
    );
  }

  // 只有 click_at 是严格必需的 — 文本输入可以使用 press_key 或 fill
  const requiredVisualTools = ['click_at'];
  const missingVisualTools = requiredVisualTools.filter(
    (t) => !availableToolNames.includes(t),
  );

  // 检查是否可以启用视觉功能；如果所有检查都通过则返回 undefined
  function getVisionDisabledReason(): string | undefined {
    const browserConfig = config.getBrowserAgentConfig();
    if (!browserConfig.customConfig.visualModel) {
      return '未配置 visualModel。';
    }
    if (missingVisualTools.length > 0) {
      return (
        `视觉工具缺失 (${missingVisualTools.join(', ')}). ` +
        `安装的 chrome-devtools-mcp 版本可能过旧。`
      );
    }
    // 当前仅支持 OPENAI_COMPATIBLE 认证类型，无需额外检查
    return undefined;
  }

  const allTools: AnyDeclarativeTool[] = [...mcpTools];
  const visionDisabledReason = getVisionDisabledReason();

  if (visionDisabledReason) {
    debugLogger.log(`视觉功能已禁用: ${visionDisabledReason}`);
  } else {
    allTools.push(
      createAnalyzeScreenshotTool(browserManager, config, messageBus),
    );
  }

  debugLogger.log(
    `为浏览器代理创建了 ${allTools.length} 个工具: ` +
      allTools.map((t) => t.name).join(', '),
  );

  // 创建带有工具的配置定义
  // BrowserAgentDefinition 是一个工厂函数 - 使用 config 调用它
  const baseDefinition = BrowserAgentDefinition(config, !visionDisabledReason);
  const definition: LocalAgentDefinition<typeof BrowserTaskResultSchema> = {
    ...baseDefinition,
    toolConfig: {
      tools: allTools,
    },
  };

  return { definition, browserManager };
}

/**
 * 关闭所有持久化浏览器会话并清理资源。
 *
 * 在 /clear 命令和 CLI 退出时调用此函数以重置浏览器状态。
 */
export async function resetBrowserSession(): Promise<void> {
  await BrowserManager.resetAll();
}
