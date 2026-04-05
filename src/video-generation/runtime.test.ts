import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { createEmptyPluginRegistry } from "../plugins/registry.js";

const { resolveRuntimePluginRegistryMock } = vi.hoisted(() => ({
  resolveRuntimePluginRegistryMock: vi.fn<
    (params?: unknown) => ReturnType<typeof createEmptyPluginRegistry> | undefined
  >(() => undefined),
}));

vi.mock("../plugins/loader.js", () => ({
  resolveRuntimePluginRegistry: resolveRuntimePluginRegistryMock,
}));

let generateVideo: typeof import("./runtime.js").generateVideo;
let listRuntimeVideoGenerationProviders: typeof import("./runtime.js").listRuntimeVideoGenerationProviders;

describe("video-generation runtime helpers", () => {
  afterEach(() => {
    resolveRuntimePluginRegistryMock.mockReset();
    resolveRuntimePluginRegistryMock.mockReturnValue(undefined);
  });

  beforeEach(async () => {
    vi.resetModules();
    ({ generateVideo, listRuntimeVideoGenerationProviders } = await import("./runtime.js"));
  });

  it("generates videos through the active video-generation registry", async () => {
    const pluginRegistry = createEmptyPluginRegistry();
    const authStore = { version: 1, profiles: {} } as const;
    let seenAuthStore: unknown;
    pluginRegistry.videoGenerationProviders.push({
      pluginId: "video-plugin",
      pluginName: "Video Plugin",
      source: "test",
      provider: {
        id: "video-plugin",
        capabilities: {
          generate: {
            supportsDuration: true,
          },
        },
        async generateVideo(req) {
          seenAuthStore = req.authStore;
          return {
            videos: [
              {
                buffer: Buffer.from("mp4-bytes"),
                mimeType: "video/mp4",
                fileName: "sample.mp4",
              },
            ],
            model: "video-v1",
          };
        },
      },
    });
    resolveRuntimePluginRegistryMock.mockReturnValue(pluginRegistry);

    const cfg = {
      agents: {
        defaults: {
          videoGenerationModel: {
            primary: "video-plugin/video-v1",
          },
        },
      },
    } as OpenClawConfig;

    const result = await generateVideo({
      cfg,
      prompt: "animate a paper airplane flying through clouds",
      agentDir: "/tmp/agent",
      authStore,
      duration: 6,
    });

    expect(result.provider).toBe("video-plugin");
    expect(result.model).toBe("video-v1");
    expect(result.attempts).toEqual([]);
    expect(seenAuthStore).toEqual(authStore);
    expect(result.videos).toEqual([
      {
        buffer: Buffer.from("mp4-bytes"),
        mimeType: "video/mp4",
        fileName: "sample.mp4",
      },
    ]);
  });

  it("lists runtime video-generation providers from the active registry", () => {
    const pluginRegistry = createEmptyPluginRegistry();
    pluginRegistry.videoGenerationProviders.push({
      pluginId: "video-plugin",
      pluginName: "Video Plugin",
      source: "test",
      provider: {
        id: "video-plugin",
        defaultModel: "video-v1",
        models: ["video-v1", "video-v2"],
        capabilities: {
          generate: {
            supportsDuration: true,
            supportsResolution: true,
            supportsFirstFrameImage: true,
          },
          geometry: {
            durations: [6, 10],
            resolutions: ["768P", "1080P"],
          },
        },
        generateVideo: async () => ({
          videos: [{ buffer: Buffer.from("x"), mimeType: "video/mp4" }],
        }),
      },
    });
    resolveRuntimePluginRegistryMock.mockReturnValue(pluginRegistry);

    expect(listRuntimeVideoGenerationProviders()).toMatchObject([
      {
        id: "video-plugin",
        defaultModel: "video-v1",
        models: ["video-v1", "video-v2"],
        capabilities: {
          generate: {
            supportsDuration: true,
            supportsResolution: true,
            supportsFirstFrameImage: true,
          },
          geometry: {
            durations: [6, 10],
            resolutions: ["768P", "1080P"],
          },
        },
      },
    ]);
  });

  it("explains native video-generation config and provider auth when no model is configured", async () => {
    const pluginRegistry = createEmptyPluginRegistry();
    pluginRegistry.videoGenerationProviders.push({
      pluginId: "minimax",
      pluginName: "MiniMax",
      source: "test",
      provider: {
        id: "minimax",
        defaultModel: "MiniMax-Hailuo-2.3",
        capabilities: {
          generate: {
            supportsDuration: true,
          },
        },
        generateVideo: async () => ({
          videos: [{ buffer: Buffer.from("x"), mimeType: "video/mp4" }],
        }),
      },
    });
    resolveRuntimePluginRegistryMock.mockReturnValue(pluginRegistry);

    const promise = generateVideo({
      cfg: {} as OpenClawConfig,
      prompt: "animate a paper airplane flying through clouds",
    });

    await expect(promise).rejects.toThrow("No video-generation model configured.");
    await expect(promise).rejects.toThrow(
      'Set agents.defaults.videoGenerationModel.primary to a provider/model like "',
    );
    await expect(promise).rejects.toThrow("minimax: MINIMAX_API_KEY");
  });
});