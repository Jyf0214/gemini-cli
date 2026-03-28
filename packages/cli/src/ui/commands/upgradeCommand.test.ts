/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { upgradeCommand } from './upgradeCommand.js';
import { type CommandContext } from './types.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import {
  openBrowserSecurely,
  shouldLaunchBrowser,
  UPGRADE_URL_PAGE,
} from '@google/gemini-cli-core';

vi.mock('@google/gemini-cli-core', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@google/gemini-cli-core')>();
  return {
    ...actual,
    openBrowserSecurely: vi.fn(),
    shouldLaunchBrowser: vi.fn().mockReturnValue(true),
    UPGRADE_URL_PAGE: 'https://goo.gle/set-up-gemini-code-assist',
  };
});

describe('upgradeCommand', () => {
  let mockContext: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    mockContext = createMockCommandContext({
      services: {
        agentContext: {
          config: {
            getContentGeneratorConfig: vi.fn().mockReturnValue({
              authType: 'openai-compatible',
            }),
            getUserTierName: vi.fn().mockReturnValue(undefined),
          },
        },
      },
    } as unknown as CommandContext);
  });

  it('should have the correct name and description', () => {
    expect(upgradeCommand.name).toBe('upgrade');
    expect(upgradeCommand.description).toBe(
      '升级您的 Gemini Code Assist 套餐以获得更高限额',
    );
  });

  it('should call openBrowserSecurely with UPGRADE_URL_PAGE', async () => {
    if (!upgradeCommand.action) {
      throw new Error('The upgrade command must have an action.');
    }

    await upgradeCommand.action(mockContext, '');

    expect(openBrowserSecurely).toHaveBeenCalledWith(UPGRADE_URL_PAGE);
  });

  it('should return an error message if openBrowserSecurely fails', async () => {
    vi.mocked(openBrowserSecurely).mockRejectedValue(
      new Error('Failed to open'),
    );

    if (!upgradeCommand.action) {
      throw new Error('The upgrade command must have an action.');
    }

    const result = await upgradeCommand.action(mockContext, '');

    expect(result).toEqual({
      type: 'message',
      messageType: 'error',
      content: '打开升级页面失败: Failed to open',
    });
  });

  it('should return URL message when shouldLaunchBrowser returns false', async () => {
    vi.mocked(shouldLaunchBrowser).mockReturnValue(false);

    if (!upgradeCommand.action) {
      throw new Error('The upgrade command must have an action.');
    }

    const result = await upgradeCommand.action(mockContext, '');

    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: `请在浏览器中打开此 URL: ${UPGRADE_URL_PAGE}`,
    });
    expect(openBrowserSecurely).not.toHaveBeenCalled();
  });

  it('should return info message for ultra tiers', async () => {
    vi.mocked(
      mockContext.services.agentContext!.config.getUserTierName,
    ).mockReturnValue('Advanced Ultra');

    if (!upgradeCommand.action) {
      throw new Error('The upgrade command must have an action.');
    }

    const result = await upgradeCommand.action(mockContext, '');

    expect(result).toEqual({
      type: 'message',
      messageType: 'info',
      content: '您已在最高套餐: Advanced Ultra。',
    });
    expect(openBrowserSecurely).not.toHaveBeenCalled();
  });
});
