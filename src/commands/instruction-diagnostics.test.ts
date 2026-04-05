import { describe, expect, it } from "vitest";
import type { SessionEntry } from "../config/sessions/types.js";
import { buildLatestInstructionDiagnosticsFromStore } from "./instruction-diagnostics.js";

function createEntry(params: {
  sessionId: string;
  updatedAt: number;
  generatedAt?: number;
  workspaceDir?: string | null;
}): SessionEntry {
  return {
    sessionId: params.sessionId,
    updatedAt: params.updatedAt,
    systemPromptReport: {
      source: "run",
      generatedAt: params.generatedAt ?? params.updatedAt,
      workspaceDir: params.workspaceDir ?? undefined,
      systemPrompt: {
        chars: 0,
        projectContextChars: 0,
        nonProjectContextChars: 0,
      },
      instructionFiles: {
        total: 1,
        loaded: 1,
        missing: 0,
        importErrorCount: 0,
        entries: [
          {
            name: "AGENTS.md",
            path: `${params.workspaceDir ?? "/tmp"}/AGENTS.md`,
            missing: false,
            kind: "agents" as const,
            loadMode: "workspace-root" as const,
            order: 1,
          },
        ],
      },
      injectedWorkspaceFiles: [],
      skills: {
        promptChars: 0,
        entries: [],
      },
      tools: {
        listChars: 0,
        schemaChars: 0,
        entries: [],
      },
    },
  };
}

describe("buildLatestInstructionDiagnosticsFromStore", () => {
  it("returns the newest available report by default", () => {
    const store = {
      "agent:main:older": createEntry({
        sessionId: "older-session",
        updatedAt: 1_000,
        workspaceDir: "workspace/older",
      }),
      "agent:main:newer": createEntry({
        sessionId: "newer-session",
        updatedAt: 2_000,
        workspaceDir: "workspace/newer",
      }),
    };

    const latest = buildLatestInstructionDiagnosticsFromStore({
      store,
      agentId: "main",
      now: 3_000,
    });

    expect(latest?.sessionKey).toBe("agent:main:newer");
    expect(latest?.workspaceDir).toBe("workspace/newer");
  });

  it("returns the latest matching session when sessionKey is provided", () => {
    const store = {
      "agent:main:older": createEntry({
        sessionId: "older-session",
        updatedAt: 1_000,
        workspaceDir: "workspace/older",
      }),
      "agent:main:newer": createEntry({
        sessionId: "newer-session",
        updatedAt: 2_000,
        workspaceDir: "workspace/newer",
      }),
    };

    const latest = buildLatestInstructionDiagnosticsFromStore({
      store,
      agentId: "main",
      now: 3_000,
      sessionKey: "agent:main:older",
    });

    expect(latest?.sessionKey).toBe("agent:main:older");
    expect(latest?.workspaceDir).toBe("workspace/older");
  });

  it("returns the latest matching workspace report before sorting", () => {
    const store = {
      "agent:main:older": createEntry({
        sessionId: "older-session",
        updatedAt: 1_000,
        workspaceDir: "workspace/project-alpha",
      }),
      "agent:main:newer": createEntry({
        sessionId: "newer-session",
        updatedAt: 2_000,
        workspaceDir: "workspace/project-beta",
      }),
    };

    const latest = buildLatestInstructionDiagnosticsFromStore({
      store,
      agentId: "main",
      now: 3_000,
      workspaceDir: "workspace/project-alpha/",
    });

    expect(latest?.sessionKey).toBe("agent:main:older");
    expect(latest?.workspaceDir).toBe("workspace/project-alpha");
  });
});