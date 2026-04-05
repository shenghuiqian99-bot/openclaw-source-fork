import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";

const note = vi.hoisted(() => vi.fn());
const collectLatestInstructionDiagnostics = vi.hoisted(() => vi.fn());

vi.mock("../terminal/note.js", () => ({
  note,
}));

vi.mock("./instruction-diagnostics.js", () => ({
  collectLatestInstructionDiagnostics,
}));

import { noteInstructionDiagnosticsHealth } from "./doctor-instructions.js";

describe("noteInstructionDiagnosticsHealth", () => {
  beforeEach(() => {
    note.mockClear();
    collectLatestInstructionDiagnostics.mockReset();
    collectLatestInstructionDiagnostics.mockReturnValue([]);
  });

  it("stays silent when no persisted instruction diagnostics exist", () => {
    noteInstructionDiagnosticsHealth({} as OpenClawConfig);

    expect(note).not.toHaveBeenCalled();
  });

  it("emits a summarized note for the latest known instruction diagnostics", () => {
    collectLatestInstructionDiagnostics.mockReturnValue([
      {
        agentId: "main",
        sessionKey: "agent:main:main",
        sessionId: "session-1",
        updatedAt: Date.now() - 60_000,
        age: 60_000,
        generatedAt: Date.now() - 60_000,
        workspaceDir: "/tmp/openclaw",
        total: 2,
        loaded: 2,
        missing: 0,
        importErrorCount: 0,
        entries: [
          {
            name: "AGENTS.md",
            path: "/tmp/openclaw/AGENTS.md",
            missing: false,
            kind: "agents",
            loadMode: "workspace-root",
            order: 1,
          },
          {
            name: ".claude/rules/01-team.md",
            path: "/tmp/openclaw/.claude/rules/01-team.md",
            missing: false,
            kind: "rule",
            loadMode: "rules-dir",
            order: 2,
            frontMatterStripped: true,
            rulePaths: ["src/api/**"],
            matchedRuleContextPaths: ["src/api/routes.ts"],
          },
        ],
      },
    ]);

    noteInstructionDiagnosticsHealth({} as OpenClawConfig);

    expect(note).toHaveBeenCalledTimes(1);
    const [message, title] = note.mock.calls[0] ?? [];
    expect(String(title)).toBe("Instruction diagnostics");
    expect(String(message)).toContain("main: 2/2 loaded");
    expect(String(message)).toContain("session agent:main:main");
    expect(String(message)).toContain("AGENTS.md");
    expect(String(message)).toContain("01-team.md");
    expect(String(message)).toContain("paths=src/api/**");
    expect(String(message)).toContain("matched=src/api/routes.ts");
  });
});