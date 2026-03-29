/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useCallback, useMemo, useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { loadApiKey } from '@google/gemini-cli-core';
import { useKeypress } from '../hooks/useKeypress.js';
import { theme } from '../semantic-colors.js';
import { RadioButtonSelect } from './shared/RadioButtonSelect.js';
import { useSettings } from '../contexts/SettingsContext.js';
import { SettingScope } from '../../config/settings.js';

interface OpenAIModelDialogProps {
  onClose: () => void;
}

export function OpenAIModelDialog({
  onClose,
}: OpenAIModelDialogProps): React.JSX.Element {
  const settings = useSettings();

  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [customModelId, setCustomModelId] = useState('');
  const [isAddingCustom, setIsAddingCustom] = useState(false);
  const [persistMode, setPersistMode] = useState(false);

  const endpoint = settings.merged.security?.auth?.openaiEndpoint || '';
  const currentModel = settings.merged.security?.auth?.openaiModel || '';

  useEffect(() => {
    if (currentModel) {
      setAvailableModels((prev) =>
        prev.includes(currentModel) ? prev : [...prev, currentModel],
      );
    }
  }, [currentModel]);

  const fetchModelsFromEndpoint = useCallback(async () => {
    if (!endpoint) {
      setErrorMessage('未配置端点');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const apiKey = await loadApiKey();
      // 移除末尾的 /v1（如果有的话）
      let baseUrl = endpoint.replace(/\/$/, '');
      if (baseUrl.endsWith('/v1')) {
        baseUrl = baseUrl.slice(0, -3);
      }
      const url = `${baseUrl}/v1/models`;
      const response = await fetch(url, {
        headers: apiKey
          ? { Authorization: `Bearer ${apiKey}` }
          : { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        // 端点不支持 /v1/models，静默处理
        return;
      }

      const data = (await response.json()) as {
        data?: Array<{ id: string }>;
      };
      const models = (data.data || []).map((m) => m.id);
      setAvailableModels((prev) => {
        const combined = [...new Set([...models, ...prev])];
        return combined;
      });
    } catch {
      // 请求失败，静默处理（很多端点不支持 /v1/models）
    } finally {
      setIsLoading(false);
    }
  }, [endpoint]);

  const addCustomModel = useCallback(() => {
    if (customModelId.trim()) {
      setAvailableModels((prev) => {
        if (prev.includes(customModelId.trim())) {
          return prev;
        }
        return [...prev, customModelId.trim()];
      });
      setCustomModelId('');
      setIsAddingCustom(false);
    }
  }, [customModelId]);

  const saveModelToSettings = useCallback(
    (model: string) => {
      try {
        settings.setValue(
          SettingScope.User,
          'security.auth.openaiModel',
          model,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to save model';
        setErrorMessage(msg);
      }
    },
    [settings],
  );

  const handleSelect = useCallback(
    (model: string) => {
      if (persistMode) {
        saveModelToSettings(model);
      }
      onClose();
    },
    [onClose, persistMode, saveModelToSettings],
  );

  const modelOptions = useMemo(() => {
    return availableModels.map((model) => ({
      value: model,
      label: model,
      key: model,
    }));
  }, [availableModels]);

  useKeypress(
    (key) => {
      if (isAddingCustom) {
        if (key.name === 'escape') {
          setIsAddingCustom(false);
          setCustomModelId('');
          return true;
        }
        if (key.name === 'enter') {
          addCustomModel();
          return true;
        }
        if (key.name === 'backspace') {
          setCustomModelId((prev) => prev.slice(0, -1));
          return true;
        }
        if (key.ctrl || key.shift || key.alt) {
          return false;
        }
        if (key.name === 'return' || key.name === 'space') {
          return false;
        }
        if (key.name.length === 1) {
          setCustomModelId((prev) => prev + key.name);
          return true;
        }
        return false;
      }

      if (key.name === 'escape') {
        onClose();
        return true;
      }
      if (key.name === 'tab') {
        setPersistMode((prev) => !prev);
        return true;
      }
      if (key.name === 'r') {
        fetchModelsFromEndpoint();
        return true;
      }
      if (key.name === 'a') {
        setIsAddingCustom(true);
        return true;
      }
      return false;
    },
    { isActive: true },
  );

  return (
    <Box
      borderStyle="round"
      borderColor={theme.border.default}
      flexDirection="column"
      padding={1}
      width="100%"
    >
      <Text bold>Select OpenAI-Compatible Model</Text>

      <Box marginTop={1} flexDirection="column">
        <Text>Available Models:</Text>
        {isLoading ? (
          <Text color={theme.text.secondary}>正在获取模型列表...</Text>
        ) : modelOptions.length === 0 ? (
          <Text color={theme.text.secondary}>
            未找到可用模型。按 [A] 手动添加模型 ID。
          </Text>
        ) : (
          <RadioButtonSelect
            items={modelOptions}
            onSelect={handleSelect}
            initialIndex={0}
            showNumbers={true}
          />
        )}
      </Box>

      {errorMessage && (
        <Box marginTop={1}>
          <Text color={theme.status.error}>{errorMessage}</Text>
        </Box>
      )}

      <Box marginTop={1} flexDirection="column">
        {isAddingCustom ? (
          <Box flexDirection="column">
            <Text>Enter model ID and press Enter:</Text>
            <Text color={theme.text.primary}>{customModelId}</Text>
            <Text color={theme.text.secondary}>(Press Esc to cancel)</Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            <Box>
              <Text color={theme.text.primary}>[R] </Text>
              <Text>Refresh from endpoint</Text>
            </Box>
            <Box>
              <Text color={theme.text.primary}>[A] </Text>
              <Text>Add custom model ID</Text>
            </Box>
          </Box>
        )}
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text color={theme.text.primary}>
            Remember model for future sessions:{' '}
          </Text>
          <Text color={theme.status.success}>
            {persistMode ? 'true' : 'false'}
          </Text>
        </Box>
        <Text color={theme.text.secondary}>(Press Tab to toggle)</Text>
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Text color={theme.text.secondary}>(Press Esc to close)</Text>
      </Box>
    </Box>
  );
}
