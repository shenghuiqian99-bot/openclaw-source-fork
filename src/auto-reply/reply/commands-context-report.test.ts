import { describe, expect, it } from "vitest";
import { buildContextReply } from "./commands-context-report.js";
import type { HandleCommandsParams } from "./commands-types.js";

function makeParams(
  commandBodyNormalized: string,
  truncated: boolean,
  options?: { omitBootstrapLimits?: boolean },
): HandleCommandsParams {
  return {
    command: {
      commandBodyNormalized,
      channel: "telegram",
      senderIsOwner: true,
    },
    sessionKey: "agent:default:main",
    workspaceDir: "/tmp/workspace",
    contextTokens: null,
    provider: "openai",
    model: "gpt-5",
    elevated: { allowed: false },
    resolvedThinkLevel: "off",
    resolvedReasoningLevel: "off",
    sessionEntry: {
      totalTokens: 123,
      inputTokens: 100,
      outputTokens: 23,
      systemPromptReport: {
        source: "run",
        generatedAt: Date.now(),
        workspaceDir: "/tmp/workspace",
        bootstrapMaxChars: options?.omitBootstrapLimits ? undefined : 20_000,
        bootstrapTotalMaxChars: options?.omitBootstrapLimits ? undefined : 150_000,
        sandbox: { mode: "off", sandboxed: false },
        systemPrompt: {
          chars: 1_000,
          projectContextChars: 500,
          nonProjectContextChars: 500,
        },
        injectedWorkspaceFiles: [
          {
            name: "AGENTS.md",
            path: "/tmp/workspace/AGENTS.md",
            missing: false,
            rawChars: truncated ? 200_000 : 10_000,
            injectedChars: truncated ? 20_000 : 10_000,
            truncated,
          },
        ],
        skills: {
          promptChars: 10,
          entries: [{ name: "checks", blockChars: 10 }],
        },
        tools: {
          listChars: 10,
          schemaChars: 20,
          entries: [{ name: "read", summaryChars: 10, schemaChars: 20, propertiesCount: 1 }],
        },
      },
    },
    cfg: {},
    ctx: {},
    commandBody: "",
    commandArgs: [],
    resolvedElevatedLevel: "off",
  } as unknown as HandleCommandsParams;
}

describe("buildContextReply", () => {
  it("shows bootstrap truncation warning in list output when context exceeds configured limits", async () => {
    const result = await buildContextReply(makeParams("/context list", true));
    expect(result.text).toContain("Bootstrap max/total: 150,000 chars");
    expect(result.text).toContain("⚠ Bootstrap context is over configured limits");
    expect(result.text).toContain("Causes: 1 file(s) exceeded max/file.");
  });

  it("does not show bootstrap truncation warning when there is no truncation", async () => {
    const result = await buildContextReply(makeParams("/context list", false));
    expect(result.text).not.toContain("Bootstrap context is over configured limits");
  });

  it("falls back to config defaults when legacy reports are missing bootstrap limits", async () => {
    const result = await buildContextReply(
      makeParams("/context list", false, {
        omitBootstrapLimits: true,
      }),
    );
    expect(result.text).toContain("Bootstrap max/file: 20,000 chars");
    expect(result.text).toContain("Bootstrap max/total: 150,000 chars");
    expect(result.text).not.toContain("Bootstrap max/file: ? chars");
  });

  it("shows instruction load diagnostics in detailed output when available", async () => {
    const params = makeParams("/context detail", false);
    params.sessionEntry!.systemPromptReport!.instructionFiles = {
      total: 2,
      loaded: 2,
      missing: 0,
      importErrorCount: 1,
      entries: [
        {
          name: "CLAUDE.md",
          path: "/tmp/workspace/.claude/CLAUDE.md",
          missing: false,
          kind: "claude-project",
          loadMode: "nested-fallback",
          order: 1,
          importErrors: 1,
        },
        {
          name: ".claude/rules/01-team.md",
          path: "/tmp/workspace/.claude/rules/01-team.md",
          missing: false,
          kind: "rule",
          loadMode: "rules-dir",
          order: 2,
          frontMatterStripped: true,
          rulePaths: ["src/api/**"],
          matchedRuleContextPaths: ["src/api/routes.ts"],
        },
      ],
    };

    const result = await buildContextReply(params);

    expect(result.text).toContain("Instructions: 2/2 loaded, 0 missing, 1 import errors");
    expect(result.text).toContain("Instruction files:");
    expect(result.text).toContain("CLAUDE.md: LOADED | kind=Claude project | mode=nested-fallback");
    expect(result.text).toContain("frontmatter stripped");
    expect(result.text).toContain("paths=src/api/**");
    expect(result.text).toContain("matched=src/api/routes.ts");
    expect(result.text).toContain("1 import error(s)");
  });
});
