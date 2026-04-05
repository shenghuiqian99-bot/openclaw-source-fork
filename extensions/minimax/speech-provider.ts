import { normalizeResolvedSecretInputString } from "openclaw/plugin-sdk/secret-input";
import type {
  SpeechProviderConfig,
  SpeechProviderOverrides,
  SpeechProviderPlugin,
} from "openclaw/plugin-sdk/speech-core";
import {
  DEFAULT_MINIMAX_TTS_BASE_URL,
  DEFAULT_MINIMAX_TTS_MODEL,
  DEFAULT_MINIMAX_TTS_VOICE_ID,
  minimaxTTS,
  MINIMAX_TTS_MODELS,
} from "./tts.js";

type MinimaxSpeechConfig = {
  apiKey?: string;
  baseUrl: string;
  model: string;
  voiceId: string;
  speed?: number;
  vol?: number;
  pitch?: number;
  format?: string;
  sampleRate?: number;
  bitrate?: number;
  channel?: number;
  languageBoost?: string;
};

function trimToUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function normalizeMinimaxSpeechConfig(rawConfig: Record<string, unknown>): MinimaxSpeechConfig {
  const providers = asObject(rawConfig.providers);
  const raw = asObject(providers?.minimax) ?? asObject(rawConfig.minimax);
  return {
    apiKey: normalizeResolvedSecretInputString({
      value: raw?.apiKey,
      path: "messages.tts.providers.minimax.apiKey",
    }),
    baseUrl:
      trimToUndefined(raw?.baseUrl) ??
      trimToUndefined(process.env.MINIMAX_TTS_BASE_URL) ??
      DEFAULT_MINIMAX_TTS_BASE_URL,
    model:
      trimToUndefined(raw?.model) ??
      trimToUndefined(process.env.MINIMAX_TTS_MODEL) ??
      DEFAULT_MINIMAX_TTS_MODEL,
    voiceId:
      trimToUndefined(raw?.voiceId) ??
      trimToUndefined(raw?.voice) ??
      trimToUndefined(process.env.MINIMAX_TTS_VOICE_ID) ??
      DEFAULT_MINIMAX_TTS_VOICE_ID,
    speed: asNumber(raw?.speed),
    vol: asNumber(raw?.vol),
    pitch: asNumber(raw?.pitch),
    format: trimToUndefined(raw?.format),
    sampleRate: asNumber(raw?.sampleRate),
    bitrate: asNumber(raw?.bitrate),
    channel: asNumber(raw?.channel),
    languageBoost: trimToUndefined(raw?.languageBoost),
  };
}

function readMinimaxProviderConfig(config: SpeechProviderConfig): MinimaxSpeechConfig {
  const normalized = normalizeMinimaxSpeechConfig({});
  return {
    apiKey: trimToUndefined(config.apiKey) ?? normalized.apiKey,
    baseUrl: trimToUndefined(config.baseUrl) ?? normalized.baseUrl,
    model: trimToUndefined(config.model) ?? normalized.model,
    voiceId: trimToUndefined(config.voiceId) ?? trimToUndefined(config.voice) ?? normalized.voiceId,
    speed: asNumber(config.speed) ?? normalized.speed,
    vol: asNumber(config.vol) ?? normalized.vol,
    pitch: asNumber(config.pitch) ?? normalized.pitch,
    format: trimToUndefined(config.format) ?? normalized.format,
    sampleRate: asNumber(config.sampleRate) ?? normalized.sampleRate,
    bitrate: asNumber(config.bitrate) ?? normalized.bitrate,
    channel: asNumber(config.channel) ?? normalized.channel,
    languageBoost: trimToUndefined(config.languageBoost) ?? normalized.languageBoost,
  };
}

function readMinimaxOverrides(
  overrides: SpeechProviderOverrides | undefined,
): Partial<MinimaxSpeechConfig> {
  if (!overrides) {
    return {};
  }
  return {
    model: trimToUndefined(overrides.model),
    voiceId: trimToUndefined(overrides.voiceId) ?? trimToUndefined(overrides.voice),
    speed: asNumber(overrides.speed),
  };
}

export function buildMinimaxSpeechProvider(): SpeechProviderPlugin {
  return {
    id: "minimax",
    label: "MiniMax",
    autoSelectOrder: 25,
    models: MINIMAX_TTS_MODELS,
    resolveConfig: ({ rawConfig }) => normalizeMinimaxSpeechConfig(rawConfig),
    resolveTalkConfig: ({ baseTtsConfig, talkProviderConfig }) => {
      const base = normalizeMinimaxSpeechConfig(baseTtsConfig);
      return {
        ...base,
        ...(talkProviderConfig.apiKey === undefined
          ? {}
          : {
              apiKey: normalizeResolvedSecretInputString({
                value: talkProviderConfig.apiKey,
                path: "talk.providers.minimax.apiKey",
              }),
            }),
        ...(trimToUndefined(talkProviderConfig.baseUrl) == null
          ? {}
          : { baseUrl: trimToUndefined(talkProviderConfig.baseUrl) }),
        ...(trimToUndefined(talkProviderConfig.modelId) == null
          ? {}
          : { model: trimToUndefined(talkProviderConfig.modelId) }),
        ...(trimToUndefined(talkProviderConfig.voiceId) == null
          ? {}
          : { voiceId: trimToUndefined(talkProviderConfig.voiceId) }),
      };
    },
    resolveTalkOverrides: ({ params }) => ({
      ...(trimToUndefined(params.voiceId) == null
        ? {}
        : { voiceId: trimToUndefined(params.voiceId) }),
      ...(trimToUndefined(params.modelId) == null
        ? {}
        : { model: trimToUndefined(params.modelId) }),
      ...(asNumber(params.speed) == null ? {} : { speed: asNumber(params.speed) }),
    }),
    isConfigured: ({ providerConfig }) =>
      Boolean(readMinimaxProviderConfig(providerConfig).apiKey || process.env.MINIMAX_API_KEY),
    synthesize: async (req) => {
      const config = readMinimaxProviderConfig(req.providerConfig);
      const overrides = readMinimaxOverrides(req.providerOverrides);
      const apiKey = config.apiKey || process.env.MINIMAX_API_KEY;
      if (!apiKey) {
        throw new Error("MiniMax API key missing");
      }
      const result = await minimaxTTS({
        text: req.text,
        apiKey,
        baseUrl: config.baseUrl,
        model: overrides.model ?? config.model,
        voiceId: overrides.voiceId ?? config.voiceId,
        speed: overrides.speed ?? config.speed,
        vol: config.vol,
        pitch: config.pitch,
        format: req.target === "voice-note" ? "mp3" : config.format,
        sampleRate: config.sampleRate,
        bitrate: config.bitrate,
        channel: config.channel,
        languageBoost: config.languageBoost,
        timeoutMs: req.timeoutMs,
      });
      return {
        audioBuffer: result.audioBuffer,
        outputFormat: result.outputFormat,
        fileExtension: result.outputFormat === "wav" ? ".wav" : ".mp3",
        voiceCompatible: true,
      };
    },
  };
}