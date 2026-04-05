import {
  assertOkOrThrowHttpError,
  normalizeBaseUrl,
} from "openclaw/plugin-sdk/provider-http";

export const DEFAULT_MINIMAX_TTS_BASE_URL = "https://api.minimax.io";
export const DEFAULT_MINIMAX_TTS_MODEL = "speech-2.8-hd";
export const DEFAULT_MINIMAX_TTS_VOICE_ID = "English_expressive_narrator";

export const MINIMAX_TTS_MODELS = [
  "speech-2.8-hd",
  "speech-2.8-turbo",
  "speech-2.6-hd",
  "speech-2.6-turbo",
  "speech-02-hd",
  "speech-02-turbo",
] as const;

type MinimaxTtsTaskCreateResponse = {
  task_id?: number | string;
  file_id?: number | string;
  base_resp?: {
    status_code?: number;
    status_msg?: string;
  };
};

type MinimaxTtsTaskQueryResponse = {
  status?: string;
  file_id?: number | string;
  error_message?: string;
  base_resp?: {
    status_code?: number;
    status_msg?: string;
  };
};

function resolveMinimaxOrigin(baseUrl?: string): string {
  const normalized = normalizeBaseUrl(baseUrl, DEFAULT_MINIMAX_TTS_BASE_URL);
  try {
    return new URL(normalized).origin;
  } catch {
    return DEFAULT_MINIMAX_TTS_BASE_URL;
  }
}

function trimToUndefined(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringifyScalar(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asInteger(value: unknown): number | undefined {
  const next = asNumber(value);
  return next == null ? undefined : Math.trunc(next);
}

function isTerminalTaskStatus(status: string): boolean {
  return status === "Success" || status === "Fail";
}

function readBaseRespError(payload: {
  base_resp?: {
    status_code?: number;
    status_msg?: string;
  };
}): string | undefined {
  const statusCode = payload.base_resp?.status_code;
  if (statusCode == null || statusCode === 0) {
    return undefined;
  }
  const message = payload.base_resp?.status_msg?.trim();
  return message ? `(${statusCode}) ${message}` : `(${statusCode})`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readOctalTarNumber(field: Buffer): number {
  const value = field
    .toString("utf8")
    .replace(/\0/g, "")
    .trim();
  return value ? Number.parseInt(value, 8) : 0;
}

function extractFirstTarFile(buffer: Buffer): { buffer: Buffer; fileName?: string } | null {
  let offset = 0;
  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      return null;
    }

    const name = header
      .subarray(0, 100)
      .toString("utf8")
      .replace(/\0/g, "")
      .trim();
    const size = readOctalTarNumber(header.subarray(124, 136));
    const typeFlag = header.subarray(156, 157).toString("utf8") || "0";
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > buffer.length) {
      return null;
    }

    if ((typeFlag === "0" || typeFlag === "") && size > 0) {
      return {
        buffer: buffer.subarray(dataStart, dataEnd),
        ...(name ? { fileName: name } : {}),
      };
    }

    offset = dataStart + Math.ceil(size / 512) * 512;
  }

  return null;
}

async function downloadMinimaxTtsFile(params: {
  apiKey: string;
  baseUrl: string;
  fileId: string;
  fetchFn: typeof fetch;
}): Promise<{ ready: false } | { ready: true; audioBuffer: Buffer }> {
  const fileResponse = await params.fetchFn(
    `${params.baseUrl}/v1/files/retrieve_content?file_id=${encodeURIComponent(params.fileId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
      },
    },
  );
  await assertOkOrThrowHttpError(fileResponse, "MiniMax TTS file retrieval failed");

  const contentType = fileResponse.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    const payload = (await fileResponse.json()) as {
      base_resp?: {
        status_code?: number;
        status_msg?: string;
      };
    };
    const error = readBaseRespError(payload);
    if (error) {
      return { ready: false };
    }
    return { ready: false };
  }

  const rawBuffer = Buffer.from(await fileResponse.arrayBuffer());
  if (contentType.includes("application/x-tar")) {
    const extracted = extractFirstTarFile(rawBuffer);
    if (!extracted) {
      throw new Error("MiniMax TTS file retrieval failed: empty tar archive");
    }
    return { ready: true, audioBuffer: extracted.buffer };
  }

  return { ready: true, audioBuffer: rawBuffer };
}

export function normalizeMinimaxTtsFormat(format?: string): "mp3" | "wav" {
  return format?.trim().toLowerCase() === "wav" ? "wav" : "mp3";
}

export function buildMinimaxTtsPayload(params: {
  text: string;
  model?: string;
  voiceId?: string;
  speed?: number;
  vol?: number;
  pitch?: number;
  format?: string;
  sampleRate?: number;
  bitrate?: number;
  channel?: number;
  languageBoost?: string;
}): Record<string, unknown> {
  return {
    model: trimToUndefined(params.model) ?? DEFAULT_MINIMAX_TTS_MODEL,
    text: params.text,
    language_boost: trimToUndefined(params.languageBoost) ?? "auto",
    voice_setting: {
      voice_id: trimToUndefined(params.voiceId) ?? DEFAULT_MINIMAX_TTS_VOICE_ID,
      speed: asNumber(params.speed) ?? 1,
      vol: asNumber(params.vol) ?? 1,
      pitch: asNumber(params.pitch) ?? 0,
    },
    audio_setting: {
      audio_sample_rate: asInteger(params.sampleRate) ?? 32000,
      bitrate: asInteger(params.bitrate) ?? 128000,
      format: normalizeMinimaxTtsFormat(params.format),
      channel: asInteger(params.channel) ?? 1,
    },
  };
}

export async function minimaxTTS(params: {
  text: string;
  apiKey: string;
  baseUrl?: string;
  model?: string;
  voiceId?: string;
  speed?: number;
  vol?: number;
  pitch?: number;
  format?: string;
  sampleRate?: number;
  bitrate?: number;
  channel?: number;
  languageBoost?: string;
  timeoutMs: number;
  fetchFn?: typeof fetch;
}): Promise<{ audioBuffer: Buffer; outputFormat: "mp3" | "wav" }> {
  const fetchFn = params.fetchFn ?? fetch;
  const baseUrl = resolveMinimaxOrigin(params.baseUrl);
  const outputFormat = normalizeMinimaxTtsFormat(params.format);
  const headers = {
    Authorization: `Bearer ${params.apiKey}`,
    "Content-Type": "application/json",
  };

  const createResponse = await fetchFn(`${baseUrl}/v1/t2a_async_v2`, {
    method: "POST",
    headers,
    body: JSON.stringify(
      buildMinimaxTtsPayload({
        text: params.text,
        model: params.model,
        voiceId: params.voiceId,
        speed: params.speed,
        vol: params.vol,
        pitch: params.pitch,
        format: outputFormat,
        sampleRate: params.sampleRate,
        bitrate: params.bitrate,
        channel: params.channel,
        languageBoost: params.languageBoost,
      }),
    ),
  });

  await assertOkOrThrowHttpError(createResponse, "MiniMax TTS task creation failed");
  const createPayload = (await createResponse.json()) as MinimaxTtsTaskCreateResponse;
  const createError = readBaseRespError(createPayload);
  if (createError) {
    throw new Error(`MiniMax TTS task creation failed ${createError}`);
  }
  const taskId = stringifyScalar(createPayload.task_id);
  if (!taskId) {
    throw new Error("MiniMax TTS task creation failed: missing task_id");
  }
  let fileId = stringifyScalar(createPayload.file_id);

  const deadline = Date.now() + params.timeoutMs;
  while (Date.now() < deadline) {
    const queryResponse = await fetchFn(
      `${baseUrl}/v1/query/t2a_async_query_v2?task_id=${encodeURIComponent(taskId)}`,
      {
        method: "GET",
        headers,
      },
    );
    await assertOkOrThrowHttpError(queryResponse, "MiniMax TTS task query failed");
    const queryPayload = (await queryResponse.json()) as MinimaxTtsTaskQueryResponse;
    const queryError = readBaseRespError(queryPayload);
    if (queryError) {
      throw new Error(`MiniMax TTS task query failed ${queryError}`);
    }

    const status = trimToUndefined(queryPayload.status);
    fileId = stringifyScalar(queryPayload.file_id) ?? fileId;
    if (fileId) {
      const download = await downloadMinimaxTtsFile({
        apiKey: params.apiKey,
        baseUrl,
        fileId,
        fetchFn,
      });
      if (download.ready) {
        return {
          audioBuffer: download.audioBuffer,
          outputFormat,
        };
      }
    }
    if (status === "Success") {
      break;
    }
    if (status === "Fail") {
      throw new Error(
        `MiniMax TTS generation failed: ${trimToUndefined(queryPayload.error_message) ?? "unknown error"}`,
      );
    }
    if (status && !isTerminalTaskStatus(status)) {
      await sleep(1000);
      continue;
    }
    await sleep(1000);
  }

  if (!fileId) {
    throw new Error("MiniMax TTS generation timed out before file_id became available");
  }

  const finalDownload = await downloadMinimaxTtsFile({
    apiKey: params.apiKey,
    baseUrl,
    fileId,
    fetchFn,
  });
  if (!finalDownload.ready) {
    throw new Error("MiniMax TTS generation timed out before audio became available");
  }

  return {
    audioBuffer: finalDownload.audioBuffer,
    outputFormat,
  };
}