/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type React from 'react';
import { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import { TextInput } from '../components/shared/TextInput.js';
import { useTextBuffer } from '../components/shared/text-buffer.js';
import { useKeypress } from '../hooks/useKeypress.js';

interface OpenAIAuthDialogProps {
  onSubmit: (endpoint: string, apiKey: string, model: string) => void;
  onCancel: () => void;
  error?: string | null;
  defaultEndpoint?: string;
  defaultApiKey?: string;
  defaultModel?: string;
}

export function OpenAIAuthDialog({
  onSubmit,
  onCancel,
  error,
  defaultEndpoint = '',
  defaultApiKey = '',
  defaultModel = '',
}: OpenAIAuthDialogProps): React.JSX.Element {
  const terminalWidth = 80;
  const viewportWidth = terminalWidth - 8;
  const [activeFieldIndex, setActiveFieldIndex] = useState(0);

  const endpointBuffer = useTextBuffer({
    initialText: defaultEndpoint || '',
    initialCursorOffset: defaultEndpoint?.length || 0,
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

  const buffers = [endpointBuffer, apiKeyBuffer, modelBuffer];
  const fieldLabels = ['Endpoint URL', 'API Key', 'Model Name'];
  const placeholders = ['https://api.openai.com/v1', 'sk-...', 'gpt-4o'];

  const handleSubmit = useCallback(() => {
    const endpoint = endpointBuffer.text.trim();
    const apiKey = apiKeyBuffer.text.trim();
    const model = modelBuffer.text.trim();
    onSubmit(endpoint, apiKey, model);
  }, [endpointBuffer, apiKeyBuffer, modelBuffer, onSubmit]);

  const handleNextField = useCallback(() => {
    setActiveFieldIndex((prev) => (prev + 1) % 3);
  }, []);

  const handlePrevField = useCallback(() => {
    setActiveFieldIndex((prev) => (prev - 1 + 3) % 3);
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
      if (activeFieldIndex < 2) {
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
        Configure OpenAI-Compatible API
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.text.primary}>
          Enter the endpoint, API key, and model name for an OpenAI-compatible
          API.
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
              <Text color={theme.text.secondary}> (active)</Text>
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
        </Box>
      ))}
      {error && (
        <Box marginTop={1}>
          <Text color={theme.status.error}>{error}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color={theme.text.secondary}>
          (Tab or Ctrl+→ to switch fields, Enter to submit, Esc to cancel)
        </Text>
      </Box>
    </Box>
  );
}
