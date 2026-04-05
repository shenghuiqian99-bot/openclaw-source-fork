import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import { saveMediaBuffer } from "../../media/store.js";
import { loadWebMedia } from "../../media/web-media.js";
import { getProviderEnvVars } from "../../secrets/provider-env-vars.js";
import { resolveUserPath } from "../../utils.js";
import { normalizeProviderId } from "../provider-id.js";
import { ToolInputError, readNumberParam, readStringArrayParam, readStringParam } from "./common.js";
import { decodeDataUrl } from "./image-tool.helpers.js";
import {
  applyVideoGenerationModelConfigDefaults,
  resolveMediaToolLocalRoots,
} from "./media-tool-shared.js";
import {
  buildToolModelConfigFromCandidates,
  coerceToolModelConfig,
  hasToolModelConfig,
  resolveDefaultModelRef,
  type ToolModelConfig,
} from "./model-config.helpers.js";
import type { AnyAgentTool } from "./common.js";
import {
  generateVideo,
  listRuntimeVideoGenerationProviders,
} from "../../video-generation/runtime.js";
import {
  parseVideoGenerationModelRef,
} from "../../video-generation/model-ref.js";
import type {
  VideoGenerationProvider,
  VideoGenerationSourceImage,
} from "../../video-generation/types.js";

const MAX_SUBJECT_IMAGES = 4;
const DEFAULT_DURATION = 6;

const VideoGenerateToolSchema = Type.Object({
  action: Type.Optional(
    Type.String({
      description:
        'Optional action: "generate" (default) or "list" to inspect available providers/models.',
    }),
  ),
  prompt: Type.Optional(Type.String({ description: "Video generation prompt." })),
  model: Type.Optional(
    Type.String({ description: "Optional provider/model override, e.g. minimax/MiniMax-Hailuo-2.3." }),
  ),
  image: Type.Optional(
    Type.String({ description: "Optional first-frame image path or URL for image-to-video." }),
  ),
  lastImage: Type.Optional(
    Type.String({ description: "Optional last-frame image path or URL for first-last-frame mode." }),
  ),
  subjectImages: Type.Optional(
    Type.Array(Type.String(), {
      description: `Optional subject reference image paths or URLs (up to ${MAX_SUBJECT_IMAGES}).`,
    }),
  ),
  duration: Type.Optional(
    Type.Number({ description: "Optional duration in seconds, typically 6 or 10.", minimum: 1 }),
  ),
  resolution: Type.Optional(
    Type.String({ description: "Optional provider-specific resolution like 768P or 1080P." }),
  ),
  filename: Type.Optional(
    Type.String({
      description:
        "Optional output filename hint. OpenClaw preserves the basename and saves under its managed media directory.",
    }),
  ),
});

function resolveAction(args: Record<string, unknown>): "generate" | "list" {
  const raw = readStringParam(args, "action");
  if (!raw) {
    return "generate";
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "generate" || normalized === "list") {
    return normalized;
  }
  throw new ToolInputError('action must be "generate" or "list"');
}

function normalizeResolution(raw: string | undefined): string | undefined {
  const normalized = raw?.trim().toUpperCase();
  return normalized || undefined;
}

function resolveDuration(args: Record<string, unknown>): number {
  return readNumberParam(args, "duration", { integer: true }) ?? DEFAULT_DURATION;
}

function normalizeSubjectImages(args: Record<string, unknown>): string[] {
  const inputs = readStringArrayParam(args, "subjectImages") ?? [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const candidate of inputs) {
    const trimmed = candidate.trim();
    const dedupe = trimmed.startsWith("@") ? trimmed.slice(1).trim() : trimmed;
    if (!dedupe || seen.has(dedupe)) {
      continue;
    }
    seen.add(dedupe);
    normalized.push(trimmed);
  }
  if (normalized.length > MAX_SUBJECT_IMAGES) {
    throw new ToolInputError(
      `Too many subject images: ${normalized.length} provided, maximum is ${MAX_SUBJECT_IMAGES}.`,
    );
  }
  return normalized;
}

async function loadInputImage(
  rawInput: string,
  workspaceDir?: string,
): Promise<{ sourceImage: VideoGenerationSourceImage; resolvedImage: string }> {
  const trimmed = rawInput.trim();
  const imageRaw = trimmed.startsWith("@") ? trimmed.slice(1).trim() : trimmed;
  if (!imageRaw) {
    throw new ToolInputError("image required");
  }
  const looksLikeWindowsDrivePath = /^[a-zA-Z]:[\\/]/.test(imageRaw);
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(imageRaw);
  const isFileUrl = /^file:/i.test(imageRaw);
  const isHttpUrl = /^https?:\/\//i.test(imageRaw);
  const isDataUrl = /^data:/i.test(imageRaw);
  if (hasScheme && !looksLikeWindowsDrivePath && !isFileUrl && !isHttpUrl && !isDataUrl) {
    throw new ToolInputError(
      `Unsupported image reference: ${rawInput}. Use a file path, a file:// URL, a data: URL, or an http(s) URL.`,
    );
  }

  const resolvedImage = imageRaw.startsWith("~") ? resolveUserPath(imageRaw) : imageRaw;
  const localRoots = resolveMediaToolLocalRoots(workspaceDir, undefined, isDataUrl ? undefined : [resolvedImage]);
  const media = isDataUrl
    ? decodeDataUrl(resolvedImage)
    : await loadWebMedia(
        resolvedImage.startsWith("file://") ? resolvedImage.slice("file://".length) : resolvedImage,
        { localRoots },
      );
  if (media.kind !== "image") {
    throw new ToolInputError(`Unsupported media type: ${media.kind}`);
  }
  const mimeType =
    ("contentType" in media && media.contentType) ||
    ("mimeType" in media && media.mimeType) ||
    "image/png";
  return {
    sourceImage: {
      buffer: media.buffer,
      mimeType,
    },
    resolvedImage,
  };
}

function resolveVideoGenerationModelCandidates(
  cfg: OpenClawConfig | undefined,
): Array<string | undefined> {
  const providerDefaults = new Map<string, string>();
  for (const provider of listRuntimeVideoGenerationProviders({ config: cfg })) {
    const providerId = provider.id.trim();
    const modelId = provider.defaultModel?.trim();
    if (!providerId || !modelId || providerDefaults.has(providerId)) {
      continue;
    }
    providerDefaults.set(providerId, `${providerId}/${modelId}`);
  }

  const orderedProviders = [resolveDefaultModelRef(cfg).provider, "minimax", ...providerDefaults.keys()];
  const orderedRefs: string[] = [];
  const seen = new Set<string>();
  for (const providerId of orderedProviders) {
    const ref = providerDefaults.get(providerId);
    if (!ref || seen.has(ref)) {
      continue;
    }
    seen.add(ref);
    orderedRefs.push(ref);
  }
  return orderedRefs;
}

export function resolveVideoGenerationModelConfigForTool(params: {
  cfg?: OpenClawConfig;
  agentDir?: string;
}): ToolModelConfig | null {
  const explicit = coerceToolModelConfig(params.cfg?.agents?.defaults?.videoGenerationModel);
  if (hasToolModelConfig(explicit)) {
    return explicit;
  }
  return buildToolModelConfigFromCandidates({
    explicit,
    agentDir: params.agentDir,
    candidates: resolveVideoGenerationModelCandidates(params.cfg),
  });
}

function resolveSelectedVideoGenerationProvider(params: {
  config?: OpenClawConfig;
  videoGenerationModelConfig: ToolModelConfig;
  modelOverride?: string;
}): VideoGenerationProvider | undefined {
  const selectedRef =
    parseVideoGenerationModelRef(params.modelOverride) ??
    parseVideoGenerationModelRef(params.videoGenerationModelConfig.primary);
  if (!selectedRef) {
    return undefined;
  }
  const selectedProvider = normalizeProviderId(selectedRef.provider);
  return listRuntimeVideoGenerationProviders({ config: params.config }).find(
    (provider) =>
      normalizeProviderId(provider.id) === selectedProvider ||
      (provider.aliases ?? []).some((alias: string) => normalizeProviderId(alias) === selectedProvider),
  );
}

function validateVideoGenerationCapabilities(params: {
  provider: VideoGenerationProvider | undefined;
  hasFirstFrameImage: boolean;
  hasLastFrameImage: boolean;
  subjectImageCount: number;
  duration?: number;
  resolution?: string;
}) {
  const provider = params.provider;
  if (!provider) {
    return;
  }
  const caps = provider.capabilities.generate;
  const geometry = provider.capabilities.geometry;

  if (params.hasFirstFrameImage && !caps.supportsFirstFrameImage) {
    throw new ToolInputError(`${provider.id} does not support first-frame image input.`);
  }
  if (params.hasLastFrameImage && !caps.supportsLastFrameImage) {
    throw new ToolInputError(`${provider.id} does not support last-frame image input.`);
  }
  if (params.subjectImageCount > 0) {
    if (!caps.supportsSubjectImages) {
      throw new ToolInputError(`${provider.id} does not support subject reference images.`);
    }
    const maxSubjectImages = caps.maxSubjectImages ?? MAX_SUBJECT_IMAGES;
    if (params.subjectImageCount > maxSubjectImages) {
      throw new ToolInputError(
        `${provider.id} supports at most ${maxSubjectImages} subject image${maxSubjectImages === 1 ? "" : "s"}.`,
      );
    }
  }
  if (params.duration != null) {
    if (!caps.supportsDuration) {
      throw new ToolInputError(`${provider.id} does not support duration overrides.`);
    }
    if (
      (geometry?.durations?.length ?? 0) > 0 &&
      !geometry?.durations?.includes(params.duration)
    ) {
      throw new ToolInputError(
        `${provider.id} duration must be one of ${geometry?.durations?.join(", ")}.`,
      );
    }
  }
  if (params.resolution) {
    if (!caps.supportsResolution) {
      throw new ToolInputError(`${provider.id} does not support resolution overrides.`);
    }
    if (
      (geometry?.resolutions?.length ?? 0) > 0 &&
      !geometry?.resolutions?.includes(params.resolution)
    ) {
      throw new ToolInputError(
        `${provider.id} resolution must be one of ${geometry?.resolutions?.join(", ")}.`,
      );
    }
  }
}

export function createVideoGenerateTool(options?: {
  config?: OpenClawConfig;
  agentDir?: string;
  workspaceDir?: string;
}): AnyAgentTool | null {
  const cfg = options?.config ?? loadConfig();
  const videoGenerationModelConfig = resolveVideoGenerationModelConfigForTool({
    cfg,
    agentDir: options?.agentDir,
  });
  if (!videoGenerationModelConfig) {
    return null;
  }
  const effectiveCfg =
    applyVideoGenerationModelConfigDefaults(cfg, videoGenerationModelConfig) ?? cfg;

  return {
    label: "Video Generation",
    name: "video_generate",
    description:
      'Generate short videos with the configured or inferred video-generation model. Set agents.defaults.videoGenerationModel.primary to pick a provider/model. Use action="list" to inspect available providers, models, and auth hints. Generated videos are delivered automatically from the tool result as MEDIA paths.',
    parameters: VideoGenerateToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = resolveAction(params);
      if (action === "list") {
        const providers = listRuntimeVideoGenerationProviders({ config: effectiveCfg }).map(
          (provider) => ({
            id: provider.id,
            ...(provider.label ? { label: provider.label } : {}),
            ...(provider.defaultModel ? { defaultModel: provider.defaultModel } : {}),
            models: provider.models ?? (provider.defaultModel ? [provider.defaultModel] : []),
            authEnvVars: getProviderEnvVars(provider.id),
            capabilities: provider.capabilities,
          }),
        );
        const lines = providers.flatMap((provider) => {
          const caps: string[] = [];
          if (provider.capabilities.generate.supportsDuration) {
            caps.push(
              (provider.capabilities.geometry?.durations?.length ?? 0) > 0
                ? `durations ${provider.capabilities.geometry?.durations?.join(", ")}`
                : "duration override",
            );
          }
          if (provider.capabilities.generate.supportsResolution) {
            caps.push(
              (provider.capabilities.geometry?.resolutions?.length ?? 0) > 0
                ? `resolutions ${provider.capabilities.geometry?.resolutions?.join(", ")}`
                : "resolution override",
            );
          }
          if (provider.capabilities.generate.supportsFirstFrameImage) {
            caps.push("first-frame image");
          }
          if (provider.capabilities.generate.supportsLastFrameImage) {
            caps.push("last-frame image");
          }
          if (provider.capabilities.generate.supportsSubjectImages) {
            caps.push(
              `subject images${provider.capabilities.generate.maxSubjectImages ? ` up to ${provider.capabilities.generate.maxSubjectImages}` : ""}`,
            );
          }
          const modelLine =
            provider.models.length > 0
              ? `models: ${provider.models.join(", ")}`
              : "models: unknown";
          return [
            `${provider.id}${provider.defaultModel ? ` (default ${provider.defaultModel})` : ""}`,
            `  ${modelLine}`,
            ...(provider.authEnvVars.length > 0
              ? [`  auth: set ${provider.authEnvVars.join(" / ")} to use ${provider.id}/*`]
              : []),
            ...(caps.length > 0 ? [`  capabilities: ${caps.join("; ")}`] : []),
          ];
        });
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          details: { providers },
        };
      }

      const prompt = readStringParam(params, "prompt", { required: true });
      const model = readStringParam(params, "model");
      const filename = readStringParam(params, "filename");
      const firstImageInput = readStringParam(params, "image");
      const lastImageInput = readStringParam(params, "lastImage");
      const subjectImageInputs = normalizeSubjectImages(params);
      const duration = resolveDuration(params);
      const resolution = normalizeResolution(readStringParam(params, "resolution"));

      if (lastImageInput && !firstImageInput) {
        throw new ToolInputError("lastImage requires image to also be set.");
      }

      const firstFrameLoaded = firstImageInput
        ? await loadInputImage(firstImageInput, options?.workspaceDir)
        : null;
      const lastFrameLoaded = lastImageInput
        ? await loadInputImage(lastImageInput, options?.workspaceDir)
        : null;
      const loadedSubjectImages = await Promise.all(
        subjectImageInputs.map((entry) => loadInputImage(entry, options?.workspaceDir)),
      );

      const selectedProvider = resolveSelectedVideoGenerationProvider({
        config: effectiveCfg,
        videoGenerationModelConfig,
        modelOverride: model,
      });
      validateVideoGenerationCapabilities({
        provider: selectedProvider,
        hasFirstFrameImage: Boolean(firstFrameLoaded),
        hasLastFrameImage: Boolean(lastFrameLoaded),
        subjectImageCount: loadedSubjectImages.length,
        duration,
        resolution,
      });

      const mode = loadedSubjectImages.length > 0
        ? "subject-reference"
        : lastFrameLoaded
          ? "first-last-frame"
          : firstFrameLoaded
            ? "image-to-video"
            : "text-to-video";

      const result = await generateVideo({
        cfg: effectiveCfg,
        prompt,
        agentDir: options?.agentDir,
        modelOverride: model,
        mode,
        duration,
        resolution,
        firstFrameImage: firstFrameLoaded?.sourceImage,
        lastFrameImage: lastFrameLoaded?.sourceImage,
        subjectImages: loadedSubjectImages.map((entry) => entry.sourceImage),
      });

      const savedVideos = await Promise.all(
        result.videos.map((video) =>
          saveMediaBuffer(
            video.buffer,
            video.mimeType,
            "tool-video-generation",
            undefined,
            filename || video.fileName,
          ),
        ),
      );

      return {
        content: [
          {
            type: "text",
            text: `Generated ${savedVideos.length} video${savedVideos.length === 1 ? "" : "s"} with ${result.provider}/${result.model}.`,
          },
        ],
        details: {
          provider: result.provider,
          model: result.model,
          count: savedVideos.length,
          mode,
          duration,
          ...(resolution ? { resolution } : {}),
          media: {
            mediaUrls: savedVideos.map((video) => video.path),
          },
          paths: savedVideos.map((video) => video.path),
          ...(firstFrameLoaded ? { image: firstFrameLoaded.resolvedImage } : {}),
          ...(lastFrameLoaded ? { lastImage: lastFrameLoaded.resolvedImage } : {}),
          ...(loadedSubjectImages.length > 0
            ? { subjectImages: loadedSubjectImages.map((entry) => entry.resolvedImage) }
            : {}),
          attempts: result.attempts,
          metadata: result.metadata,
        },
      };
    },
  };
}