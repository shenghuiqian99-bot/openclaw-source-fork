import { describe, expect, it } from "vitest";
import { withEnv } from "../../../test/helpers/extensions/env.js";
import { __testing } from "./kimi-web-search-provider.js";

const kimiApiKeyEnv = ["KIMI_API", "KEY"].join("_");

describe("kimi web search provider", () => {
  it("uses configured model and base url overrides with sane defaults", () => {
    expect(__testing.resolveKimiModel()).toBe("moonshot-v1-128k");
    expect(__testing.resolveKimiModel({ model: "kimi-k2" })).toBe("kimi-k2");
    expect(__testing.resolveKimiBaseUrl()).toBe("https://api.moonshot.ai/v1");
    expect(__testing.resolveKimiBaseUrl({ baseUrl: "https://kimi.example/v1" })).toBe(
      "https://kimi.example/v1",
    );
  });

  it("inherits the configured native Moonshot base url when web search base url is unset", () => {
    expect(
      __testing.resolveConfiguredMoonshotBaseUrl({
        models: {
          providers: {
            moonshot: {
              baseUrl: "https://api.moonshot.cn/v1",
            },
          },
        },
      }),
    ).toBe("https://api.moonshot.cn/v1");

    expect(__testing.resolveKimiBaseUrl({}, "https://api.moonshot.cn/v1")).toBe(
      "https://api.moonshot.cn/v1",
    );
  });

  it("ignores non-native Moonshot provider base urls when choosing the default web search host", () => {
    expect(
      __testing.resolveConfiguredMoonshotBaseUrl({
        models: {
          providers: {
            moonshot: {
              baseUrl: "https://proxy.example/v1",
            },
          },
        },
      }),
    ).toBeUndefined();
  });

  it("extracts unique citations from search results and tool call arguments", () => {
    expect(
      __testing.extractKimiCitations({
        search_results: [{ url: "https://a.test" }, { url: "https://b.test" }],
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    arguments: JSON.stringify({
                      url: "https://a.test",
                      search_results: [{ url: "https://c.test" }],
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
    ).toEqual(["https://a.test", "https://b.test", "https://c.test"]);
  });

  it("echoes builtin tool arguments back to Moonshot when present", () => {
    expect(
      __testing.buildKimiToolMessageContent(
        {
          function: {
            arguments: JSON.stringify({
              search_result: {
                search_id: "abc123",
              },
            }),
          },
        },
        {
          search_results: [{ url: "https://fallback.test", title: "Fallback", content: "x" }],
        },
      ),
    ).toBe(JSON.stringify({ search_result: { search_id: "abc123" } }));
  });

  it("uses config apiKey when provided", () => {
    expect(__testing.resolveKimiApiKey({ apiKey: "kimi-test-key" })).toBe("kimi-test-key");
  });

  it("falls back to env apiKey", () => {
    withEnv({ [kimiApiKeyEnv]: "kimi-env-key" }, () => {
      expect(__testing.resolveKimiApiKey({})).toBe("kimi-env-key");
    });
  });

  it("prefers the main agent-scoped Moonshot key over the generic Moonshot key", () => {
    withEnv(
      {
        OPENCLAW_MAIN_MOONSHOT_API_KEY: "main-moonshot-key",
        MOONSHOT_API_KEY: "generic-moonshot-key",
      },
      () => {
        expect(__testing.resolveKimiApiKey({})).toBe("main-moonshot-key");
      },
    );
  });
});
