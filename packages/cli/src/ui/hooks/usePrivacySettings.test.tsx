/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { render } from '../../test-utils/render.js';
import type { Config } from '@google/gemini-cli-core';
import { usePrivacySettings } from './usePrivacySettings.js';
import { waitFor } from '../../test-utils/async.js';

describe('usePrivacySettings', () => {
  const mockConfig = {} as unknown as Config;

  const renderPrivacySettingsHook = async () => {
    let hookResult: ReturnType<typeof usePrivacySettings>;
    function TestComponent() {
      hookResult = usePrivacySettings(mockConfig);
      return null;
    }
    await render(<TestComponent />);
    return {
      result: {
        get current() {
          return hookResult;
        },
      },
    };
  };

  it('should return error state since Code Assist is not supported', async () => {
    const { result } = await renderPrivacySettingsHook();

    await waitFor(() => {
      expect(result.current.privacyState.isLoading).toBe(false);
    });

    expect(result.current.privacyState.error).toBe(
      'Code Assist is not supported',
    );
    expect(result.current.privacyState.isFreeTier).toBeUndefined();
    expect(result.current.privacyState.dataCollectionOptIn).toBeUndefined();
  });

  it('should set error state when updateDataCollectionOptIn is called', async () => {
    const { result } = await renderPrivacySettingsHook();

    await waitFor(() => {
      expect(result.current.privacyState.isLoading).toBe(false);
    });

    await result.current.updateDataCollectionOptIn(true);

    expect(result.current.privacyState.error).toBe(
      'Code Assist is not supported',
    );
  });
});
