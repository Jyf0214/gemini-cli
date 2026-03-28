/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LoadedSettings } from '../../config/settings.js';

export const FETCH_TIMEOUT_MS = 2000;

export interface UpdateInfo {
  latest: string;
  current: string;
  name: string;
  type?: string;
}

export interface UpdateObject {
  message: string;
  update: UpdateInfo;
  isUpdating?: boolean;
}

export async function checkForUpdates(
  _settings: LoadedSettings,
): Promise<UpdateObject | null> {
  return null;
}
