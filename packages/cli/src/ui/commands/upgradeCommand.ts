/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  openBrowserSecurely,
  shouldLaunchBrowser,
  UPGRADE_URL_PAGE,
} from '@google/gemini-cli-core';
import { isUltraTier } from '../../utils/tierUtils.js';
import { CommandKind, type SlashCommand } from './types.js';

/**
 * 命令：打开 Gemini Code Assist 升级页面
 * 仅在用户通过 Google 登录时显示/可用
 */
export const upgradeCommand: SlashCommand = {
  name: 'upgrade',
  kind: CommandKind.BUILT_IN,
  description: '升级您的 Gemini Code Assist 套餐以获得更高限额',
  autoExecute: true,
  action: async (context) => {
    const config = context.services.agentContext?.config;
    // 由于已移除其他认证类型判断，此命令始终可用
    const tierName = config?.getUserTierName();
    if (isUltraTier(tierName)) {
      return {
        type: 'message',
        messageType: 'info',
        content: `您已在最高套餐: ${tierName}。`,
      };
    }

    if (!shouldLaunchBrowser()) {
      return {
        type: 'message',
        messageType: 'info',
        content: `请在浏览器中打开此 URL: ${UPGRADE_URL_PAGE}`,
      };
    }

    try {
      await openBrowserSecurely(UPGRADE_URL_PAGE);
    } catch (error) {
      return {
        type: 'message',
        messageType: 'error',
        content: `打开升级页面失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    return undefined;
  },
};
