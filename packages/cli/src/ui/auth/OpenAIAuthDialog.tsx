/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useCallback, useMemo } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import { TextInput } from '../components/shared/TextInput.js';
import { useTextBuffer } from '../components/shared/text-buffer.js';
import { useKeypress } from '../hooks/useKeypress.js';

interface OpenAIAuthDialogProps {
  onSubmit: (
    endpoint: string,
    apiKey: string,
    model: string,
    maxTokens?: number,
  ) => void;
  onCancel: () => void;
  error?: string | null;
  defaultEndpoint?: string;
  defaultApiKey?: string;
  defaultModel?: string;
  defaultMaxTokens?: string;
}

export function OpenAIAuthDialog({
  onSubmit,
  onCancel,
  error,
  defaultEndpoint = '',
  defaultApiKey = '',
  defaultModel = '',
  defaultMaxTokens = '',
}: OpenAIAuthDialogProps): React.JSX.Element {
  const terminalWidth = 80;
  const viewportWidth = terminalWidth - 8;
  const [activeFieldIndex, setActiveFieldIndex] = useState(0);

  // 清理默认端点，去掉 /v1 后缀
  const cleanDefaultEndpoint = useMemo(() => {
    return defaultEndpoint.replace(/\/v1$/, '').replace(/\/$/, '');
  }, [defaultEndpoint]);

  const endpointBuffer = useTextBuffer({
    initialText: cleanDefaultEndpoint || '',
    initialCursorOffset: cleanDefaultEndpoint?.length || 0,
    viewport: {
      width: viewportWidth,
      height: 4,
    },
    inputFilter: (text) => text.replace(/[\r\n]/g, ''),
    singleLine: true,
  });

  const apiKeyBuffer = useTextBuffer({
    initialText: defaultApiKey || '',
    initialCursorOffset: defaultApiKey?.length || 0,
    viewport: {
      width: viewportWidth,
      height: 4,
    },
    inputFilter: (text) => text.replace(/[\r\n]/g, ''),
    singleLine: true,
  });

  const modelBuffer = useTextBuffer({
    initialText: defaultModel || '',
    initialCursorOffset: defaultModel?.length || 0,
    viewport: {
      width: viewportWidth,
      height: 4,
    },
    inputFilter: (text) => text.replace(/[\r\n]/g, ''),
    singleLine: true,
  });

  const maxTokensBuffer = useTextBuffer({
    initialText: defaultMaxTokens || '',
    initialCursorOffset: defaultMaxTokens?.length || 0,
    viewport: {
      width: viewportWidth,
      height: 4,
    },
    inputFilter: (text) => text.replace(/[\r\n]/g, ''),
    singleLine: true,
  });

  const buffers = [endpointBuffer, apiKeyBuffer, modelBuffer, maxTokensBuffer];
  const fieldLabels = ['端点 URL', 'API 密钥', '模型名称', '最大 token 数'];
  const placeholders = [
    'https://api.example.com',
    'sk-...',
    'model-name',
    '例如 4096',
  ];

  // 检测端点是否包含 /v1 后缀
  const endpointHasV1Suffix = useMemo(() => {
    return (
      endpointBuffer.text.trim().endsWith('/v1') ||
      endpointBuffer.text.trim().endsWith('/v1/')
    );
  }, [endpointBuffer.text]);

  const handleSubmit = useCallback(() => {
    // 自动去掉 /v1 后缀和末尾斜杠
    const endpoint = endpointBuffer.text
      .trim()
      .replace(/\/v1\/?$/, '')
      .replace(/\/$/, '');
    const apiKey = apiKeyBuffer.text.trim();
    const model = modelBuffer.text.trim();
    const maxTokensText = maxTokensBuffer.text.trim();
    const maxTokens = maxTokensText ? parseInt(maxTokensText, 10) : undefined;
    onSubmit(endpoint, apiKey, model, maxTokens);
  }, [endpointBuffer, apiKeyBuffer, modelBuffer, maxTokensBuffer, onSubmit]);

  const handleNextField = useCallback(() => {
    setActiveFieldIndex((prev) => (prev + 1) % 4);
  }, []);

  const handlePrevField = useCallback(() => {
    setActiveFieldIndex((prev) => (prev - 1 + 4) % 4);
  }, []);

  useKeypress(
    (key) => {
      if (key.name === 'tab' || (key.name === 'right' && key.ctrl)) {
        handleNextField();
        return true;
      }
      if (key.name === 'left' && key.ctrl) {
        handlePrevField();
        return true;
      }
      return false;
    },
    { isActive: true },
  );

  const handleFieldSubmit = useCallback(
    (_value: string) => {
      if (activeFieldIndex < 3) {
        handleNextField();
      } else {
        handleSubmit();
      }
    },
    [activeFieldIndex, handleNextField, handleSubmit],
  );

  const handleFieldCancel = useCallback(() => {
    onCancel();
  }, [onCancel]);

  return (
    <Box
      borderStyle="round"
      borderColor={theme.ui.focus}
      flexDirection="column"
      padding={1}
      width="100%"
    >
      <Text bold color={theme.text.primary}>
        配置 OpenAI 兼容 API
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.text.primary}>
          请输入 OpenAI 兼容 API 的端点、密钥和模型名称。
        </Text>
      </Box>
      {fieldLabels.map((label, index) => (
        <Box key={label} marginTop={1} flexDirection="column">
          <Box flexDirection="row">
            <Text
              color={
                activeFieldIndex === index ? theme.ui.focus : theme.text.primary
              }
              bold={activeFieldIndex === index}
            >
              {label}
            </Text>
            {activeFieldIndex === index && (
              <Text color={theme.text.secondary}> (当前)</Text>
            )}
          </Box>
          <Box
            borderStyle="round"
            borderColor={
              activeFieldIndex === index ? theme.ui.focus : theme.border.default
            }
            paddingX={1}
            marginTop={0}
          >
            {activeFieldIndex === index ? (
              <TextInput
                buffer={buffers[index]}
                onSubmit={handleFieldSubmit}
                onCancel={handleFieldCancel}
                placeholder={placeholders[index]}
              />
            ) : (
              <Text color={theme.text.secondary}>
                {buffers[index].text || placeholders[index]}
              </Text>
            )}
          </Box>
          {/* 端点字段的提示 */}
          {index === 0 && (
            <Box marginTop={0}>
              {endpointHasV1Suffix ? (
                <Text color={theme.status.warning}>
                  ⚠ 检测到 /v1 后缀，提交时将自动移除
                </Text>
              ) : (
                <Text color={theme.text.secondary}>
                  请勿在端点后添加 /v1，系统会自动处理
                </Text>
              )}
            </Box>
          )}
        </Box>
      ))}
      {error && (
        <Box marginTop={1}>
          <Text color={theme.status.error}>{error}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={theme.text.secondary}>
          (Tab 或 Ctrl+→ 切换字段，回车提交，Esc 取消)
        </Text>
      </Box>
    </Box>
  );
}
