import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import * as videoGenerationRuntime from "../video-generation/runtime.js";
import { createOpenClawTools } from "./openclaw-tools.js";

vi.mock("../plugins/tools.js", () => ({
  resolvePluginTools: () => [],
  copyPluginToolMeta: () => undefined,
  getPluginToolMeta: () => undefined,
}));

function asConfig(value: unknown): OpenClawConfig {
  return value as OpenClawConfig;
}

function stubVideoGenerationProviders() {
  vi.spyOn(videoGenerationRuntime, "listRuntimeVideoGenerationProviders").mockReturnValue([
    {
      id: "minimax",
      defaultModel: "MiniMax-Hailuo-2.3",
      models: ["MiniMax-Hailuo-2.3"],
      capabilities: {
        generate: {
          supportsDuration: true,
          supportsResolution: true,
        },
        geometry: {
          durations: [6, 10],
          resolutions: ["768P", "1080P"],
        },
      },
      generateVideo: vi.fn(async () => {
        throw new Error("not used");
      }),
    },
  ]);
}

describe("openclaw tools video generation registration", () => {
  beforeEach(() => {
    vi.stubEnv("MINIMAX_API_KEY", "");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("registers video_generate when video-generation config is present", () => {
    stubVideoGenerationProviders();

    const tools = createOpenClawTools({
      config: asConfig({
        agents: {
          defaults: {
            imageGenerationModel: {
              primary: "minimax/image-01",
            },
            videoGenerationModel: {
              primary: "minimax/MiniMax-Hailuo-2.3",
            },
          },
        },
      }),
      agentDir: "/tmp/openclaw-agent-main",
    });

    expect(tools.map((tool) => tool.name)).toContain("video_generate");
  });

  it("registers video_generate when a compatible provider has env-backed auth", () => {
    stubVideoGenerationProviders();
    vi.stubEnv("MINIMAX_API_KEY", "minimax-test");

    const tools = createOpenClawTools({
      config: asConfig({
        agents: {
          defaults: {
            imageGenerationModel: {
              primary: "minimax/image-01",
            },
          },
        },
      }),
      agentDir: "/tmp/openclaw-agent-main",
    });

    expect(tools.map((tool) => tool.name)).toContain("video_generate");
  });

  it("omits video_generate when config is absent and no compatible provider auth exists", () => {
    stubVideoGenerationProviders();

    const tools = createOpenClawTools({
      config: asConfig({
        agents: {
          defaults: {
            imageGenerationModel: {
              primary: "minimax/image-01",
            },
          },
        },
      }),
      agentDir: "/tmp/openclaw-agent-main",
    });

    expect(tools.map((tool) => tool.name)).not.toContain("video_generate");
  });
});