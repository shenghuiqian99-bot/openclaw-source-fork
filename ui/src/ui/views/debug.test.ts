/* @vitest-environment jsdom */

import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import { renderDebug, type DebugProps } from "./debug.ts";

function buildProps(overrides: Partial<DebugProps> = {}): DebugProps {
  return {
    loading: false,
    status: {
      ok: true,
    },
    instructionDiagnostics: {
      reports: 1,
      byAgent: [
        {
          agentId: "main",
          sessionKey: "agent:main:main",
          sessionId: "session-1",
          workspaceDir: "C:/Users/test/.openclaw/workspace",
          loaded: 2,
          total: 4,
          missing: 0,
          importErrorCount: 0,
          entries: [
            {
              name: "AGENTS.md",
              path: "C:/Users/test/.openclaw/workspace/AGENTS.md",
              kind: "agents",
              loadMode: "workspace-root",
              order: 1,
            },
            {
              name: ".claude/rules/api.md",
              path: "C:/Users/test/.openclaw/workspace/.claude/rules/api.md",
              kind: "rule",
              loadMode: "rules-dir",
              frontMatterStripped: true,
              rulePaths: ["src/api/**"],
              matchedRuleContextPaths: ["src/api/routes.ts"],
              order: 2,
            },
            {
              name: ".claude/rules/db.md",
              path: "C:/Users/test/.openclaw/workspace/.claude/rules/db.md",
              kind: "rule",
              loadMode: "rules-dir",
              order: 3,
            },
            {
              name: "CLAUDE.md",
              path: "C:/Users/test/.openclaw/workspace/CLAUDE.md",
              kind: "claude-project",
              loadMode: "workspace-root",
              order: 4,
            },
          ],
        },
      ],
    },
    instructionDiagnosticsError: null,
    instructionDiagnosticsNotice: null,
    instructionDiagnosticsFilterAgentId: "",
    instructionDiagnosticsFilterSessionKey: "",
    instructionDiagnosticsFilterWorkspaceDir: "",
    instructionDiagnosticsExpandedKeys: [],
    health: null,
    models: [],
    heartbeat: null,
    eventLog: [],
    methods: [],
    callMethod: "",
    callParams: "{}",
    callResult: null,
    callError: null,
    onInstructionDiagnosticsFilterAgentIdChange: () => undefined,
    onInstructionDiagnosticsFilterSessionKeyChange: () => undefined,
    onInstructionDiagnosticsFilterWorkspaceDirChange: () => undefined,
    onApplyInstructionDiagnosticsFilters: () => undefined,
    onClearInstructionDiagnosticsFilters: () => undefined,
    onUseInstructionDiagnosticsInManualRpc: () => undefined,
    onCallInstructionDiagnosticsInManualRpc: () => undefined,
    onApplyInstructionDiagnosticsQuickFilter: () => undefined,
    onCopyInstructionDiagnosticsText: () => undefined,
    onToggleInstructionDiagnosticsReport: () => undefined,
    onCallMethodChange: () => undefined,
    onCallParamsChange: () => undefined,
    onRefresh: () => undefined,
    onCall: () => undefined,
    ...overrides,
  };
}

describe("debug view", () => {
  it("renders persisted instruction diagnostics as a dedicated section", async () => {
    const container = document.createElement("div");

    render(renderDebug(buildProps()), container);
    await Promise.resolve();

    const text = container.textContent ?? "";
    expect(text).toContain("Instruction diagnostics");
    expect(text).toContain("main · 2/4 loaded");
    expect(text).toContain("agent:main:main");
    expect(text).toContain("AGENTS.md");
    expect(text).toContain(".claude/rules/api.md");
    expect(text).toContain("paths=src/api/**");
    expect(text).toContain("matched=src/api/routes.ts");
    expect(text).toContain("Agent ID");
    expect(text).toContain("Session key");
    expect(text).toContain("Workspace dir");
    expect(text).toContain("Apply filters");
    expect(text).toContain("Use in Manual RPC");
    expect(text).toContain("Call in Manual RPC");
    expect(text).toContain("Copy query");
    expect(text).toContain("Copy CLI command");
    expect(text).toContain("+1 more");
    expect(text).toContain("Show all");
    expect(text).toContain("Use agent");
    expect(text).toContain("Use session");
    expect(text).toContain("Use workspace");
    expect(text).toContain("Focus report");
    expect(text).toContain("Use report in Manual RPC");
    expect(text).toContain("Call report in Manual RPC");
    expect(text).toContain("Copy report query");
    expect(text).toContain("Copy report CLI command");
    expect(text).toContain("Copy params");
    expect(text).toContain("Copy debug bundle");
    expect(text).toContain("Copy report JSON");
    expect(text).not.toContain("CLAUDE.md");
  });

  it("shows an empty-state message when the status payload has no reports", async () => {
    const container = document.createElement("div");

    render(
      renderDebug(
        buildProps({
          status: {
            instructionDiagnostics: {
              reports: 0,
              byAgent: [],
            },
          },
          instructionDiagnostics: {
            reports: 0,
            byAgent: [],
          },
        }),
      ),
      container,
    );
    await Promise.resolve();

    expect(container.textContent ?? "").toContain("No persisted instruction diagnostics yet.");
  });

  it("shows a filtered empty-state message and wiring for filter actions", async () => {
    const onApplyInstructionDiagnosticsFilters = vi.fn();
    const onClearInstructionDiagnosticsFilters = vi.fn();
    const onUseInstructionDiagnosticsInManualRpc = vi.fn();
    const onCallInstructionDiagnosticsInManualRpc = vi.fn();
    const onCopyInstructionDiagnosticsText = vi.fn();
    const container = document.createElement("div");

    render(
      renderDebug(
        buildProps({
          status: {
            instructionDiagnostics: {
              reports: 1,
              byAgent: [{ agentId: "main" }],
            },
          },
          instructionDiagnostics: null,
          instructionDiagnosticsFilterAgentId: "main",
          instructionDiagnosticsError: "Failed to load instruction diagnostics: missing scope",
          onApplyInstructionDiagnosticsFilters,
          onClearInstructionDiagnosticsFilters,
          onUseInstructionDiagnosticsInManualRpc,
          onCallInstructionDiagnosticsInManualRpc,
          onCopyInstructionDiagnosticsText,
        }),
      ),
      container,
    );
    await Promise.resolve();

    expect(container.textContent ?? "").toContain(
      "No persisted instruction diagnostics matched the current filters.",
    );
    expect(container.textContent ?? "").toContain(
      "Failed to load instruction diagnostics: missing scope",
    );
    expect(container.textContent ?? "").not.toContain("main ·");

    (container.querySelector('[data-debug-instruction-action="apply"]') as HTMLButtonElement).click();
    (container.querySelector('[data-debug-instruction-action="clear"]') as HTMLButtonElement).click();
    (container.querySelector('[data-debug-instruction-action="use-rpc"]') as HTMLButtonElement).click();
    (container.querySelector('[data-debug-instruction-action="call-rpc"]') as HTMLButtonElement).click();
    (container.querySelector('[data-debug-instruction-action="copy-query"]') as HTMLButtonElement).click();
    (container.querySelector('[data-debug-instruction-action="copy-cli"]') as HTMLButtonElement).click();

    expect(onApplyInstructionDiagnosticsFilters).toHaveBeenCalledTimes(1);
    expect(onClearInstructionDiagnosticsFilters).toHaveBeenCalledTimes(1);
    expect(onUseInstructionDiagnosticsInManualRpc).toHaveBeenCalledWith({ agentId: "main" });
    expect(onCallInstructionDiagnosticsInManualRpc).toHaveBeenCalledWith({ agentId: "main" });
    expect(onCopyInstructionDiagnosticsText).toHaveBeenNthCalledWith(
      1,
      "Copied diagnostics query.",
      '{\n  "method": "instructions.diagnostics",\n  "params": {\n    "agentId": "main"\n  }\n}',
    );
    expect(onCopyInstructionDiagnosticsText).toHaveBeenNthCalledWith(
      2,
      "Copied diagnostics CLI command.",
      "openclaw gateway call instructions.diagnostics --json --params '{\"agentId\":\"main\"}'",
    );
  });

  it("renders full report details when a diagnostics report is expanded", async () => {
    const onToggleInstructionDiagnosticsReport = vi.fn();
    const onApplyInstructionDiagnosticsQuickFilter = vi.fn();
    const onUseInstructionDiagnosticsInManualRpc = vi.fn();
    const onCallInstructionDiagnosticsInManualRpc = vi.fn();
    const onCopyInstructionDiagnosticsText = vi.fn();
    const container = document.createElement("div");

    render(
      renderDebug(
        buildProps({
          instructionDiagnosticsFilterAgentId: "main",
          instructionDiagnosticsExpandedKeys: ["agent:main:main"],
          onApplyInstructionDiagnosticsQuickFilter,
          onUseInstructionDiagnosticsInManualRpc,
          onCallInstructionDiagnosticsInManualRpc,
          onCopyInstructionDiagnosticsText,
          onToggleInstructionDiagnosticsReport,
        }),
      ),
      container,
    );
    await Promise.resolve();

    const text = container.textContent ?? "";
    expect(text).toContain("Hide details");
    expect(text).toContain("workspace=C:/Users/test/.openclaw/workspace");
    expect(text).toContain("sessionId=session-1");
    expect(text).toContain("CLAUDE.md");
    expect(text).toContain("C:/Users/test/.openclaw/workspace/CLAUDE.md");
    expect(text).not.toContain("+1 more");
    expect(text).toContain("Show raw report JSON");

    (container.querySelector('[data-debug-instruction-toggle="agent:main:main"]') as HTMLButtonElement).click();
    (container.querySelector('[data-debug-instruction-quick-filter="workspace"]') as HTMLButtonElement).click();
    (container.querySelector('[data-debug-instruction-report-focus="agent:main:main"]') as HTMLButtonElement).click();
    (container.querySelector('[data-debug-instruction-report-use="agent:main:main"]') as HTMLButtonElement).click();
    (container.querySelector('[data-debug-instruction-report-call="agent:main:main"]') as HTMLButtonElement).click();
    (container.querySelector('[data-debug-instruction-copy="report-query"]') as HTMLButtonElement).click();
    (container.querySelector('[data-debug-instruction-copy="report-cli"]') as HTMLButtonElement).click();
    (container.querySelector('[data-debug-instruction-copy="params"]') as HTMLButtonElement).click();
    (container.querySelector('[data-debug-instruction-copy="bundle"]') as HTMLButtonElement).click();
    (container.querySelector('[data-debug-instruction-copy="report"]') as HTMLButtonElement).click();

    expect(onToggleInstructionDiagnosticsReport).toHaveBeenCalledWith("agent:main:main");
    expect(onApplyInstructionDiagnosticsQuickFilter).toHaveBeenNthCalledWith(1, {
      workspaceDir: "C:/Users/test/.openclaw/workspace",
    });
    expect(onApplyInstructionDiagnosticsQuickFilter).toHaveBeenNthCalledWith(2, {
      agentId: "main",
      sessionKey: "agent:main:main",
      workspaceDir: "C:/Users/test/.openclaw/workspace",
    });
    expect(onUseInstructionDiagnosticsInManualRpc).toHaveBeenCalledWith({
      agentId: "main",
      sessionKey: "agent:main:main",
      workspaceDir: "C:/Users/test/.openclaw/workspace",
    });
    expect(onCallInstructionDiagnosticsInManualRpc).toHaveBeenCalledWith({
      agentId: "main",
      sessionKey: "agent:main:main",
      workspaceDir: "C:/Users/test/.openclaw/workspace",
    });
    expect(onCopyInstructionDiagnosticsText).toHaveBeenNthCalledWith(
      1,
      "Copied report query.",
      '{\n  "method": "instructions.diagnostics",\n  "params": {\n    "agentId": "main",\n    "sessionKey": "agent:main:main",\n    "workspaceDir": "C:/Users/test/.openclaw/workspace"\n  }\n}',
    );
    expect(onCopyInstructionDiagnosticsText).toHaveBeenNthCalledWith(
      2,
      "Copied report CLI command.",
      "openclaw gateway call instructions.diagnostics --json --params '{\"agentId\":\"main\",\"sessionKey\":\"agent:main:main\",\"workspaceDir\":\"C:/Users/test/.openclaw/workspace\"}'",
    );
    expect(onCopyInstructionDiagnosticsText).toHaveBeenNthCalledWith(
      3,
      "Copied diagnostics params.",
      '{\n  "sessionKey": "agent:main:main"\n}',
    );
    expect(onCopyInstructionDiagnosticsText).toHaveBeenNthCalledWith(
      5,
      "Copied report JSON.",
      expect.stringContaining('"sessionKey": "agent:main:main"'),
    );
    expect(onCopyInstructionDiagnosticsText).toHaveBeenNthCalledWith(
      4,
      "Copied diagnostics bundle.",
      expect.any(String),
    );
    expect(JSON.parse(onCopyInstructionDiagnosticsText.mock.calls[3][1] as string)).toEqual(
      expect.objectContaining({
        method: "instructions.diagnostics",
        activeFilters: { agentId: "main" },
        reportQuery: {
          method: "instructions.diagnostics",
          params: {
            agentId: "main",
            sessionKey: "agent:main:main",
            workspaceDir: "C:/Users/test/.openclaw/workspace",
          },
        },
        reportCliCommand:
          "openclaw gateway call instructions.diagnostics --json --params '{\"agentId\":\"main\",\"sessionKey\":\"agent:main:main\",\"workspaceDir\":\"C:/Users/test/.openclaw/workspace\"}'",
        reportFilters: {
          agentId: "main",
          sessionKey: "agent:main:main",
          workspaceDir: "C:/Users/test/.openclaw/workspace",
        },
        reportKey: "agent:main:main",
        report: expect.objectContaining({
          sessionKey: "agent:main:main",
          workspaceDir: "C:/Users/test/.openclaw/workspace",
        }),
      }),
    );
  });

  it("renders a diagnostics notice when copy feedback is present", async () => {
    const container = document.createElement("div");

    render(
      renderDebug(
        buildProps({
          instructionDiagnosticsNotice: "Copied report JSON.",
        }),
      ),
      container,
    );
    await Promise.resolve();

    expect(container.textContent ?? "").toContain("Copied report JSON.");
  });
});