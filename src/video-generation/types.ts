import type { AuthProfileStore } from "../agents/auth-profiles.js";
import type { OpenClawConfig } from "../config/config.js";

export type GeneratedVideoAsset = {
  buffer: Buffer;
  mimeType: string;
  fileName?: string;
  metadata?: Record<string, unknown>;
};

export type VideoGenerationSourceImage = {
  buffer: Buffer;
  mimeType: string;
  fileName?: string;
  metadata?: Record<string, unknown>;
};

export type VideoGenerationMode =
  | "text-to-video"
  | "image-to-video"
  | "first-last-frame"
  | "subject-reference";

export type VideoGenerationRequest = {
  provider: string;
  model: string;
  prompt: string;
  cfg: OpenClawConfig;
  agentDir?: string;
  authStore?: AuthProfileStore;
  timeoutMs?: number;
  mode?: VideoGenerationMode;
  duration?: number;
  resolution?: string;
  firstFrameImage?: VideoGenerationSourceImage;
  lastFrameImage?: VideoGenerationSourceImage;
  subjectImages?: VideoGenerationSourceImage[];
};

export type VideoGenerationResult = {
  videos: GeneratedVideoAsset[];
  model?: string;
  metadata?: Record<string, unknown>;
};

export type VideoGenerationModeCapabilities = {
  supportsDuration?: boolean;
  supportsResolution?: boolean;
  supportsFirstFrameImage?: boolean;
  supportsLastFrameImage?: boolean;
  supportsSubjectImages?: boolean;
  maxSubjectImages?: number;
};

export type VideoGenerationGeometryCapabilities = {
  durations?: number[];
  resolutions?: string[];
};

export type VideoGenerationProviderCapabilities = {
  generate: VideoGenerationModeCapabilities;
  geometry?: VideoGenerationGeometryCapabilities;
};

export type VideoGenerationProvider = {
  id: string;
  aliases?: string[];
  label?: string;
  defaultModel?: string;
  models?: string[];
  capabilities: VideoGenerationProviderCapabilities;
  generateVideo: (req: VideoGenerationRequest) => Promise<VideoGenerationResult>;
};