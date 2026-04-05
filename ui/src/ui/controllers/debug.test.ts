import { describe, expect, it, vi } from "vitest";
import { loadDebug, type DebugState } from "./debug.ts";

type RequestFn = (method: string, params?: unknown) => Promise<unknown>;

function createState(request: RequestFn, overrides: Partial<DebugState> = {}): DebugState {
  return {
    client: { request } as unknown as DebugState["client"],
    connected: true,
    debugLoading: false,
    debugStatus: null,
    debugInstructionDiagnostics: null,
    debugInstructionDiagnosticsError: null,
    debugInstructionDiagnosticsFilterAgentId: "",
    debugInstructionDiagnosticsFilterSessionKey: "",
    debugInstructionDiagnosticsFilterWorkspaceDir: "",
    debugHealth: null,
    debugModels: [],
    debugHeartbeat: null,
    debugCallMethod: "",
    debugCallParams: "{}",
    debugCallResult: null,
    debugCallError: null,
    ...overrides,
  };
}

describe("loadDebug", () => {
  it("loads dedicated instruction diagnostics alongside status snapshots", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "status") {
        return { ok: true };
      }
      if (method === "instructions.diagnostics") {
        return { reports: 1, byAgent: [{ agentId: "main" }] };
      }
      if (method === "health") {
        return { ok: true };
      }
      if (method === "models.list") {
        return { models: [{ id: "m1" }] };
      }
      if (method === "last-heartbeat") {
        return { ts: 123 };
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState(request);

    await loadDebug(state);

    expect(request).toHaveBeenCalledWith("instructions.diagnostics", {});
    expect(state.debugInstructionDiagnostics).toEqual({
      reports: 1,
      byAgent: [{ agentId: "main" }],
    });
    expect(state.debugStatus).toEqual({ ok: true });
  });

  it("passes trimmed diagnostics filters to the dedicated RPC", async () => {
    const request = vi.fn(async (method: string, params?: unknown) => {
      if (method === "status") {
        return { ok: true };
      }
      if (method === "instructions.diagnostics") {
        return { reports: 1, byAgent: [{ agentId: "main", sessionKey: "agent:main:main" }] };
      }
      if (method === "health") {
        return { ok: true };
      }
      if (method === "models.list") {
        return { models: [] };
      }
      if (method === "last-heartbeat") {
        return null;
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState(request, {
      debugInstructionDiagnosticsFilterAgentId: "  main  ",
      debugInstructionDiagnosticsFilterSessionKey: "   ",
      debugInstructionDiagnosticsFilterWorkspaceDir: "  C:/Users/test/.openclaw/workspace  ",
    });

    await loadDebug(state);

    expect(request).toHaveBeenCalledWith("instructions.diagnostics", {
      agentId: "main",
      workspaceDir: "C:/Users/test/.openclaw/workspace",
    });
    expect(state.debugInstructionDiagnosticsError).toBeNull();
  });

  it("falls back to status payload diagnostics when the dedicated call fails", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "status") {
        return {
          instructionDiagnostics: { reports: 1, byAgent: [{ agentId: "main" }] },
        };
      }
      if (method === "instructions.diagnostics") {
        throw new Error("missing scope");
      }
      if (method === "health") {
        return { ok: true };
      }
      if (method === "models.list") {
        return { models: [] };
      }
      if (method === "last-heartbeat") {
        return null;
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState(request);

    await loadDebug(state);

    expect(state.debugInstructionDiagnostics).toEqual({
      reports: 1,
      byAgent: [{ agentId: "main" }],
    });
    expect(state.debugInstructionDiagnosticsError).toBeNull();
  });

  it("does not fall back to unfiltered status diagnostics when filters are active", async () => {
    const request = vi.fn(async (method: string) => {
      if (method === "status") {
        return {
          instructionDiagnostics: { reports: 1, byAgent: [{ agentId: "main" }] },
        };
      }
      if (method === "instructions.diagnostics") {
        throw new Error("missing scope");
      }
      if (method === "health") {
        return { ok: true };
      }
      if (method === "models.list") {
        return { models: [] };
      }
      if (method === "last-heartbeat") {
        return null;
      }
      throw new Error(`unexpected method: ${method}`);
    });
    const state = createState(request, {
      debugInstructionDiagnosticsFilterSessionKey: "agent:main:main",
    });

    await loadDebug(state);

    expect(state.debugInstructionDiagnostics).toBeNull();
    expect(state.debugInstructionDiagnosticsError).toContain("Failed to load instruction diagnostics");
  });
});