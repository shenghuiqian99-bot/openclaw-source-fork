import fs from "node:fs/promises";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { runFfmpeg, runFfprobe } from "openclaw/plugin-sdk/media-runtime";
import {
  type VideoDescriptionRequest,
  type VideoDescriptionResult,
} from "openclaw/plugin-sdk/media-understanding";
import { minimaxUnderstandImage } from "../../src/agents/minimax-vlm.ts";

const DEFAULT_VIDEO_PROMPT =
  "Describe the video in terms of scene, subjects, actions, and notable changes over time.";
const DEFAULT_VIDEO_FRAME_COUNT = 4;

function trimToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function formatTimestamp(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function pickVideoSampleOffsets(durationSeconds: number, sampleCount = DEFAULT_VIDEO_FRAME_COUNT): number[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return [0];
  }
  const count = Math.max(1, Math.min(sampleCount, DEFAULT_VIDEO_FRAME_COUNT));
  if (durationSeconds <= count) {
    return Array.from({ length: count }, (_, index) =>
      Math.min(durationSeconds, (durationSeconds / count) * index),
    ).map((value) => Number(value.toFixed(3)));
  }
  return Array.from({ length: count }, (_, index) => {
    const ratio = count === 1 ? 0.5 : (index + 0.5) / count;
    return Number((durationSeconds * ratio).toFixed(3));
  });
}

async function probeDurationSeconds(videoPath: string): Promise<number> {
  const stdout = await runFfprobe([
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    videoPath,
  ]);
  const duration = Number.parseFloat(stdout.trim());
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function coerceApiHost(baseUrl?: string): string | undefined {
  const trimmed = trimToUndefined(baseUrl);
  if (!trimmed) {
    return undefined;
  }
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed;
  }
}

export async function describeMinimaxVideo(
  params: VideoDescriptionRequest,
): Promise<VideoDescriptionResult> {
  const prompt = trimToUndefined(params.prompt) ?? DEFAULT_VIDEO_PROMPT;
  const tempRoot = await mkdtemp(path.join(tmpdir(), "openclaw-minimax-video-"));
  const inputPath = path.join(tempRoot, params.fileName?.trim() || "video.mp4");

  try {
    await writeFile(inputPath, params.buffer);
    const durationSeconds = await probeDurationSeconds(inputPath);
    const offsets = pickVideoSampleOffsets(durationSeconds);

    const timeline: string[] = [];
    for (let index = 0; index < offsets.length; index += 1) {
      const offsetSeconds = offsets[index];
      const framePath = path.join(tempRoot, `frame-${index + 1}.jpg`);
      await runFfmpeg([
        "-y",
        "-ss",
        String(offsetSeconds),
        "-i",
        inputPath,
        "-frames:v",
        "1",
        framePath,
      ]);
      const frameBuffer = await fs.readFile(framePath);
      const frameDescription = await minimaxUnderstandImage({
        apiKey: params.apiKey,
        prompt:
          `${prompt}\n\n` +
          `This still frame was sampled from a video at approximately ${formatTimestamp(offsetSeconds)}. ` +
          "Focus on visible subjects, actions, camera perspective, and how this moment contributes to the clip.",
        imageDataUrl: `data:image/jpeg;base64,${frameBuffer.toString("base64")}`,
        modelBaseUrl: coerceApiHost(params.baseUrl),
      });
      timeline.push(`[${formatTimestamp(offsetSeconds)}] ${frameDescription.trim()}`);
    }

    return {
      text:
        "Frame-sampled video summary:\n" +
        timeline.join("\n\n") +
        (timeline.length > 1
          ? "\n\nThese observations are based on sampled frames across the clip and summarize the visible progression over time."
          : ""),
      model: trimToUndefined(params.model) ?? "MiniMax-M2.7",
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}