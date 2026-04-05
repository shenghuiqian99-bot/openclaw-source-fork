import { beforeEach, describe, expect, it, vi } from "vitest";

const loadConfigMock = vi.hoisted(() => vi.fn(() => ({ gateway: { mode: "local" } })));
const collectLatestInstructionDiagnosticsMock = vi.hoisted(() => vi.fn());

vi.mock("../../config/config.js", () => ({
  loadConfig: () => loadConfigMock(),
}));

vi.mock("../../commands/instruction-diagnostics.js", () => ({
  collectLatestInstructionDiagnostics: (cfg: unknown, now: unknown, filters: unknown) =>
    collectLatestInstructionDiagnosticsMock(cfg, now, filters),
}));

import { instructionsHandlers } from "./instructions.js";

describe("instructionsHandlers", () => {
  beforeEach(() => {
    loadConfigMock.mockClear();
    collectLatestInstructionDiagnosticsMock.mockReset();
  });

  it("returns latest persisted instruction diagnostics per agent", () => {
    collectLatestInstructionDiagnosticsMock.mockReturnValue([
      {
        agentId: "main",
        sessionKey: "agent:main:main",
        sessionId: "session-1",
        updatedAt: 123,
        age: 0,
        generatedAt: 123,
        workspaceDir: "E:/projects/openclaw-source",
        total: 2,
        loaded: 2,
        missing: 0,
        importErrorCount: 0,
        entries: [],
      },
    ]);
    const respond = vi.fn();

    instructionsHandlers["instructions.diagnostics"]({
      params: {
        agentId: "main",
      },
      respond,
    } as unknown as Parameters<(typeof instructionsHandlers)["instructions.diagnostics"]>[0]);

    expect(loadConfigMock).toHaveBeenCalledTimes(1);
    expect(collectLatestInstructionDiagnosticsMock).toHaveBeenCalledTimes(1);
    expect(collectLatestInstructionDiagnosticsMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Number),
      { agentId: "main" },
    );
    expect(respond).toHaveBeenCalledWith(
      true,
      {
        reports: 1,
        byAgent: [
          expect.objectContaining({
            agentId: "main",
            sessionKey: "agent:main:main",
            loaded: 2,
            total: 2,
          }),
        ],
      },
      undefined,
    );
  });

  it("returns an unavailable error when diagnostics collection fails", () => {
    collectLatestInstructionDiagnosticsMock.mockImplementation(() => {
      throw new Error("boom");
    });
    const respond = vi.fn();

    instructionsHandlers["instructions.diagnostics"]({
      params: {},
      respond,
    } as unknown as Parameters<(typeof instructionsHandlers)["instructions.diagnostics"]>[0]);

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "UNAVAILABLE",
        message: expect.stringContaining("failed to load instruction diagnostics: boom"),
      }),
    );
  });

  it("rejects invalid filter params", () => {
    const respond = vi.fn();

    instructionsHandlers["instructions.diagnostics"]({
      params: {
        agentId: "",
      },
      respond,
    } as unknown as Parameters<(typeof instructionsHandlers)["instructions.diagnostics"]>[0]);

    expect(collectLatestInstructionDiagnosticsMock).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "INVALID_REQUEST",
        message: expect.stringContaining("invalid instructions.diagnostics params"),
      }),
    );
  });
});