/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from 'react';
import type { Config } from '@google/gemini-cli-core';

export interface PrivacyState {
  isLoading: boolean;
  error?: string;
  isFreeTier?: boolean;
  dataCollectionOptIn?: boolean;
}

export const usePrivacySettings = (_config: Config) => {
  const [privacyState, setPrivacyState] = useState<PrivacyState>({
    isLoading: true,
  });

  useEffect(() => {
    setPrivacyState({
      isLoading: false,
      error: 'Code Assist is not supported',
    });
  }, []);

  const updateDataCollectionOptIn = useCallback(async (_optIn: boolean) => {
    setPrivacyState({
      isLoading: false,
      error: 'Code Assist is not supported',
    });
  }, []);

  return {
    privacyState,
    updateDataCollectionOptIn,
  };
};
