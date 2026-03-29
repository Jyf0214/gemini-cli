/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box } from 'ink';
import { type Config } from '@google/gemini-cli-core';
import { CloudFreePrivacyNotice } from './CloudFreePrivacyNotice.js';

interface PrivacyNoticeProps {
  onExit: () => void;
  config: Config;
}

const PrivacyNoticeText = ({
  config,
  onExit,
}: {
  config: Config;
  onExit: () => void;
}) => (
  // 默认显示 CloudFreePrivacyNotice（已移除其他认证类型判断）
  <CloudFreePrivacyNotice config={config} onExit={onExit} />
);
export const PrivacyNotice = ({ onExit, config }: PrivacyNoticeProps) => (
  <Box borderStyle="round" padding={1} flexDirection="column">
    <PrivacyNoticeText config={config} onExit={onExit} />
  </Box>
);
