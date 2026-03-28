/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useMemo } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import { type Config, UserAccountManager } from '@google/gemini-cli-core';
import { isUltraTier } from '../../utils/tierUtils.js';

interface UserIdentityProps {
  config: Config;
}

export const UserIdentity: React.FC<UserIdentityProps> = ({ config }) => {
  const authType = config.getContentGeneratorConfig()?.authType;
  const email = useMemo(() => {
    if (authType) {
      const userAccountManager = new UserAccountManager();
      return userAccountManager.getCachedGoogleAccount() ?? undefined;
    }
    return undefined;
  }, [authType]);

  const tierName = useMemo(
    () => (authType ? config.getUserTierName() : undefined),
    [config, authType],
  );

  const isUltra = useMemo(() => isUltraTier(tierName), [tierName]);

  if (!authType) {
    return null;
  }

  return (
    <Box flexDirection="column">
      {/* 用户邮箱 /auth */}
      <Box>
        <Text color={theme.text.primary} wrap="truncate-end">
          <Text bold>已认证{email ? ':' : ''}</Text>
          {email ? ` ${email}` : ''}
        </Text>
        <Text color={theme.text.secondary}> /auth</Text>
      </Box>

      {/* 套餐名称 /upgrade */}
      {tierName && (
        <Box>
          <Text color={theme.text.primary} wrap="truncate-end">
            <Text bold>Plan:</Text> {tierName}
          </Text>
          {!isUltra && <Text color={theme.text.secondary}> /upgrade</Text>}
        </Box>
      )}
    </Box>
  );
};
