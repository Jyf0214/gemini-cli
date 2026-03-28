/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createContentGenerator,
  AuthType,
  createContentGeneratorConfig,
  type ContentGenerator,
} from './contentGenerator.js';
import { GoogleGenAI } from '@google/genai';
import type { Config } from '../config/config.js';
import { LoggingContentGenerator } from './loggingContentGenerator.js';
import { FakeContentGenerator } from './fakeContentGenerator.js';
import { RecordingContentGenerator } from './recordingContentGenerator.js';
import { resetVersionCache } from '../utils/version.js';

vi.mock('../code_assist/codeAssist.js');
vi.mock('@google/genai');
vi.mock('./apiKeyCredentialStorage.js', () => ({
  loadApiKey: vi.fn(),
}));

vi.mock('./fakeContentGenerator.js');

describe('createContentGenerator', () => {
  beforeEach(() => {
    resetVersionCache();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should create a FakeContentGenerator', async () => {
    const mockGenerator = {} as unknown as ContentGenerator;
    vi.mocked(FakeContentGenerator.fromFile).mockResolvedValue(
      mockGenerator as never,
    );
    const fakeResponsesFile = 'fake/responses.yaml';
    const mockConfigWithFake = {
      fakeResponses: fakeResponsesFile,
      getClientName: vi.fn().mockReturnValue(undefined),
    } as unknown as Config;
    const generator = await createContentGenerator(
      {
        authType: AuthType.OPENAI_COMPATIBLE,
      },
      mockConfigWithFake,
    );
    expect(FakeContentGenerator.fromFile).toHaveBeenCalledWith(
      fakeResponsesFile,
    );
    expect(generator).toEqual(
      new LoggingContentGenerator(mockGenerator, mockConfigWithFake),
    );
  });

  it('should create a RecordingContentGenerator', async () => {
    const fakeResponsesFile = 'fake/responses.yaml';
    const recordResponsesFile = 'record/responses.yaml';
    const mockConfigWithRecordResponses = {
      fakeResponses: fakeResponsesFile,
      recordResponses: recordResponsesFile,
      getClientName: vi.fn().mockReturnValue(undefined),
    } as unknown as Config;
    const generator = await createContentGenerator(
      {
        authType: AuthType.OPENAI_COMPATIBLE,
      },
      mockConfigWithRecordResponses,
    );
    expect(generator).toBeInstanceOf(RecordingContentGenerator);
  });

  it('should create a GoogleGenAI content generator', async () => {
    const mockConfig = {
      getModel: vi.fn().mockReturnValue('gemini-pro'),
      getProxy: vi.fn().mockReturnValue(undefined),
      getUsageStatisticsEnabled: () => true,
      getClientName: vi.fn().mockReturnValue(undefined),
    } as unknown as Config;

    // Set a fixed version for testing
    vi.stubEnv('CLI_VERSION', '1.2.3');
    vi.stubEnv('TERM_PROGRAM', 'iTerm.app');
    vi.stubEnv('VSCODE_PID', '');
    vi.stubEnv('GITHUB_SHA', '');
    vi.stubEnv('GEMINI_CLI_SURFACE', '');

    const mockGenerator = {
      models: {},
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator as never);
    const generator = await createContentGenerator(
      {
        apiKey: 'test-api-key',
        authType: AuthType.OPENAI_COMPATIBLE,
      },
      mockConfig,
    );
    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: 'test-api-key',
      vertexai: undefined,
      httpOptions: expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': expect.stringMatching(
            /GeminiCLI\/1\.2\.3\/gemini-pro \(.*; .*; terminal\)/,
          ),
        }),
      }),
    });
    expect(generator).toEqual(
      new LoggingContentGenerator(mockGenerator.models, mockConfig),
    );
  });

  it('should use standard User-Agent for a2a-server running outside VS Code', async () => {
    const mockConfig = {
      getModel: vi.fn().mockReturnValue('gemini-pro'),
      getProxy: vi.fn().mockReturnValue(undefined),
      getUsageStatisticsEnabled: () => true,
      getClientName: vi.fn().mockReturnValue('a2a-server'),
    } as unknown as Config;

    // Set a fixed version for testing
    vi.stubEnv('CLI_VERSION', '1.2.3');
    vi.stubEnv('TERM_PROGRAM', 'iTerm.app');
    vi.stubEnv('VSCODE_PID', '');
    vi.stubEnv('GITHUB_SHA', '');
    vi.stubEnv('GEMINI_CLI_SURFACE', '');

    const mockGenerator = {
      models: {},
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator as never);
    await createContentGenerator(
      { apiKey: 'test-api-key', authType: AuthType.OPENAI_COMPATIBLE },
      mockConfig,
      undefined,
    );

    expect(GoogleGenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        httpOptions: expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': expect.stringMatching(
              /GeminiCLI-a2a-server\/1\.2\.3\/gemini-pro \(.*; .*; terminal\)/,
            ),
          }),
        }),
      }),
    );
  });

  it('should include unified User-Agent for a2a-server (VS Code Agent Mode)', async () => {
    const mockConfig = {
      getModel: vi.fn().mockReturnValue('gemini-pro'),
      getProxy: vi.fn().mockReturnValue(undefined),
      getUsageStatisticsEnabled: () => true,
      getClientName: vi.fn().mockReturnValue('a2a-server'),
    } as unknown as Config;

    // Set a fixed version for testing
    vi.stubEnv('CLI_VERSION', '1.2.3');
    // Mock the environment variable that the VS Code extension host would provide to the a2a-server process
    vi.stubEnv('VSCODE_PID', '12345');
    vi.stubEnv('TERM_PROGRAM', 'vscode');
    vi.stubEnv('TERM_PROGRAM_VERSION', '1.85.0');

    const mockGenerator = {
      models: {},
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator as never);
    await createContentGenerator(
      { apiKey: 'test-api-key', authType: AuthType.OPENAI_COMPATIBLE },
      mockConfig,
      undefined,
    );

    expect(GoogleGenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        httpOptions: expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': expect.stringMatching(
              /CloudCodeVSCode\/1\.2\.3 \(aidev_client; os_type=.*; os_version=.*; arch=.*; host_path=VSCode\/1\.85\.0; proxy_client=geminicli\)/,
            ),
          }),
        }),
      }),
    );
  });

  it('should include clientName prefix in User-Agent when specified (non-VSCode)', async () => {
    const mockConfig = {
      getModel: vi.fn().mockReturnValue('gemini-pro'),
      getProxy: vi.fn().mockReturnValue(undefined),
      getUsageStatisticsEnabled: () => true,
      getClientName: vi.fn().mockReturnValue('my-client'),
    } as unknown as Config;

    // Set a fixed version for testing
    vi.stubEnv('CLI_VERSION', '1.2.3');
    vi.stubEnv('TERM_PROGRAM', 'iTerm.app');
    vi.stubEnv('VSCODE_PID', '');
    vi.stubEnv('GITHUB_SHA', '');
    vi.stubEnv('GEMINI_CLI_SURFACE', '');

    const mockGenerator = {
      models: {},
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator as never);
    await createContentGenerator(
      { apiKey: 'test-api-key', authType: AuthType.OPENAI_COMPATIBLE },
      mockConfig,
      undefined,
    );

    expect(GoogleGenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        httpOptions: expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': expect.stringMatching(
              /GeminiCLI-my-client\/1\.2\.3\/gemini-pro \(.*; .*; terminal\)/,
            ),
          }),
        }),
      }),
    );
  });

  it('should allow custom headers to override User-Agent', async () => {
    const mockConfig = {
      getModel: vi.fn().mockReturnValue('gemini-pro'),
      getProxy: vi.fn().mockReturnValue(undefined),
      getUsageStatisticsEnabled: () => true,
      getClientName: vi.fn().mockReturnValue(undefined),
    } as unknown as Config;

    vi.stubEnv('GEMINI_CLI_CUSTOM_HEADERS', 'User-Agent:MyCustomUA');

    const mockGenerator = {
      models: {},
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator as never);
    await createContentGenerator(
      { apiKey: 'test-api-key', authType: AuthType.OPENAI_COMPATIBLE },
      mockConfig,
      undefined,
    );

    expect(GoogleGenAI).toHaveBeenCalledWith(
      expect.objectContaining({
        httpOptions: expect.objectContaining({
          headers: expect.objectContaining({
            'User-Agent': 'MyCustomUA',
          }),
        }),
      }),
    );
  });

  it('should include custom headers from GEMINI_CLI_CUSTOM_HEADERS for GoogleGenAI requests without inferring auth mechanism', async () => {
    const mockConfig = {
      getModel: vi.fn().mockReturnValue('gemini-pro'),
      getProxy: vi.fn().mockReturnValue(undefined),
      getUsageStatisticsEnabled: () => false,
      getClientName: vi.fn().mockReturnValue(undefined),
    } as unknown as Config;

    const mockGenerator = {
      models: {},
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator as never);
    vi.stubEnv(
      'GEMINI_CLI_CUSTOM_HEADERS',
      'X-Test-Header: test, Another: value',
    );

    await createContentGenerator(
      {
        apiKey: 'test-api-key',
        authType: AuthType.OPENAI_COMPATIBLE,
      },
      mockConfig,
    );

    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: 'test-api-key',
      vertexai: undefined,
      httpOptions: expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': expect.any(String),
          'X-Test-Header': 'test',
          Another: 'value',
        }),
      }),
    });
    expect(GoogleGenAI).toHaveBeenCalledWith(
      expect.not.objectContaining({
        httpOptions: expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.any(String),
          }),
        }),
      }),
    );
  });

  it('should pass api key as Authorization Header when GEMINI_API_KEY_AUTH_MECHANISM is set to bearer', async () => {
    const mockConfig = {
      getModel: vi.fn().mockReturnValue('gemini-pro'),
      getProxy: vi.fn().mockReturnValue(undefined),
      getUsageStatisticsEnabled: () => false,
      getClientName: vi.fn().mockReturnValue(undefined),
    } as unknown as Config;

    const mockGenerator = {
      models: {},
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator as never);
    vi.stubEnv('GEMINI_API_KEY_AUTH_MECHANISM', 'bearer');

    await createContentGenerator(
      {
        apiKey: 'test-api-key',
        authType: AuthType.OPENAI_COMPATIBLE,
      },
      mockConfig,
    );

    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: 'test-api-key',
      vertexai: undefined,
      httpOptions: expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': expect.any(String),
          Authorization: 'Bearer test-api-key',
        }),
      }),
    });
  });

  it('should not pass api key as Authorization Header when GEMINI_API_KEY_AUTH_MECHANISM is not set (default behavior)', async () => {
    const mockConfig = {
      getModel: vi.fn().mockReturnValue('gemini-pro'),
      getProxy: vi.fn().mockReturnValue(undefined),
      getUsageStatisticsEnabled: () => false,
      getClientName: vi.fn().mockReturnValue(undefined),
    } as unknown as Config;

    const mockGenerator = {
      models: {},
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator as never);
    // GEMINI_API_KEY_AUTH_MECHANISM is not stubbed, so it will be undefined, triggering default 'x-goog-api-key'

    await createContentGenerator(
      {
        apiKey: 'test-api-key',
        authType: AuthType.OPENAI_COMPATIBLE,
      },
      mockConfig,
    );

    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: 'test-api-key',
      vertexai: undefined,
      httpOptions: expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': expect.any(String),
        }),
      }),
    });
    // Explicitly assert that Authorization header is NOT present
    expect(GoogleGenAI).toHaveBeenCalledWith(
      expect.not.objectContaining({
        httpOptions: expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.any(String),
          }),
        }),
      }),
    );
  });

  it('should create a GoogleGenAI content generator with client install id logging disabled', async () => {
    const mockConfig = {
      getModel: vi.fn().mockReturnValue('gemini-pro'),
      getUsageStatisticsEnabled: () => false,
      getClientName: vi.fn().mockReturnValue(undefined),
    } as unknown as Config;
    const mockGenerator = {
      models: {},
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator as never);
    const generator = await createContentGenerator(
      {
        apiKey: 'test-api-key',
        authType: AuthType.OPENAI_COMPATIBLE,
      },
      mockConfig,
    );
    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: 'test-api-key',
      vertexai: undefined,
      httpOptions: expect.objectContaining({
        headers: {
          'User-Agent': expect.any(String),
        },
      }),
    });
    expect(generator).toEqual(
      new LoggingContentGenerator(mockGenerator.models, mockConfig),
    );
  });

  it('should pass apiVersion to GoogleGenAI when GOOGLE_GENAI_API_VERSION is set', async () => {
    const mockConfig = {
      getModel: vi.fn().mockReturnValue('gemini-pro'),
      getProxy: vi.fn().mockReturnValue(undefined),
      getUsageStatisticsEnabled: () => false,
      getClientName: vi.fn().mockReturnValue(undefined),
    } as unknown as Config;

    const mockGenerator = {
      models: {},
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator as never);
    vi.stubEnv('GOOGLE_GENAI_API_VERSION', 'v1');

    await createContentGenerator(
      {
        apiKey: 'test-api-key',
        authType: AuthType.OPENAI_COMPATIBLE,
      },
      mockConfig,
    );

    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: 'test-api-key',
      vertexai: undefined,
      httpOptions: expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': expect.any(String),
        }),
      }),
      apiVersion: 'v1',
    });
  });

  it('should not include apiVersion when GOOGLE_GENAI_API_VERSION is not set', async () => {
    const mockConfig = {
      getModel: vi.fn().mockReturnValue('gemini-pro'),
      getProxy: vi.fn().mockReturnValue(undefined),
      getUsageStatisticsEnabled: () => false,
      getClientName: vi.fn().mockReturnValue(undefined),
    } as unknown as Config;

    const mockGenerator = {
      models: {},
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator as never);

    await createContentGenerator(
      {
        apiKey: 'test-api-key',
        authType: AuthType.OPENAI_COMPATIBLE,
      },
      mockConfig,
    );

    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: 'test-api-key',
      vertexai: undefined,
      httpOptions: expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': expect.any(String),
        }),
      }),
    });

    expect(GoogleGenAI).toHaveBeenCalledWith(
      expect.not.objectContaining({
        apiVersion: expect.any(String),
      }),
    );
  });

  it('should not include apiVersion when GOOGLE_GENAI_API_VERSION is an empty string', async () => {
    const mockConfig = {
      getModel: vi.fn().mockReturnValue('gemini-pro'),
      getProxy: vi.fn().mockReturnValue(undefined),
      getUsageStatisticsEnabled: () => false,
      getClientName: vi.fn().mockReturnValue(undefined),
    } as unknown as Config;

    const mockGenerator = {
      models: {},
    } as unknown as GoogleGenAI;
    vi.mocked(GoogleGenAI).mockImplementation(() => mockGenerator as never);
    vi.stubEnv('GOOGLE_GENAI_API_VERSION', '');

    await createContentGenerator(
      {
        apiKey: 'test-api-key',
        authType: AuthType.OPENAI_COMPATIBLE,
      },
      mockConfig,
    );

    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: 'test-api-key',
      vertexai: undefined,
      httpOptions: expect.objectContaining({
        headers: expect.objectContaining({
          'User-Agent': expect.any(String),
        }),
      }),
    });

    expect(GoogleGenAI).toHaveBeenCalledWith(
      expect.not.objectContaining({
        apiVersion: expect.any(String),
      }),
    );
  });
});

describe('createContentGeneratorConfig', () => {
  const mockConfig = {
    getModel: vi.fn().mockReturnValue('gemini-pro'),
    setModel: vi.fn(),
    flashFallbackHandler: vi.fn(),
    getProxy: vi.fn(),
    getClientName: vi.fn().mockReturnValue(undefined),
  } as unknown as Config;

  beforeEach(() => {
    // Reset modules to re-evaluate imports and environment variables
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('should configure for OPENAI_COMPATIBLE with apiKey and baseUrl', async () => {
    const config = await createContentGeneratorConfig(
      mockConfig,
      AuthType.OPENAI_COMPATIBLE,
      'test-api-key',
      'https://api.example.com',
    );
    expect(config.apiKey).toBe('test-api-key');
    expect(config.vertexai).toBe(false);
    expect(config.baseUrl).toBe('https://api.example.com');
    expect(config.authType).toBe(AuthType.OPENAI_COMPATIBLE);
  });

  it('should configure for OPENAI_COMPATIBLE with custom headers', async () => {
    const customHeaders = { 'X-Custom-Header': 'value' };
    const config = await createContentGeneratorConfig(
      mockConfig,
      AuthType.OPENAI_COMPATIBLE,
      'test-api-key',
      'https://api.example.com',
      customHeaders,
    );
    expect(config.apiKey).toBe('test-api-key');
    expect(config.vertexai).toBe(false);
    expect(config.baseUrl).toBe('https://api.example.com');
    expect(config.authType).toBe(AuthType.OPENAI_COMPATIBLE);
    expect(config.customHeaders).toEqual(customHeaders);
  });
});
