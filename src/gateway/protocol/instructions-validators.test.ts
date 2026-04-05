import { describe, expect, it } from "vitest";
import { validateInstructionsDiagnosticsParams } from "./index.js";

describe("instructions diagnostics protocol validators", () => {
  it("accepts empty params and optional filter fields", () => {
    expect(validateInstructionsDiagnosticsParams({})).toBe(true);
    expect(
      validateInstructionsDiagnosticsParams({
        agentId: "main",
        sessionKey: "agent:main:main",
        workspaceDir: "C:/Users/example/.openclaw/workspace",
      }),
    ).toBe(true);
  });

  it("rejects empty strings and unexpected properties", () => {
    expect(validateInstructionsDiagnosticsParams({ agentId: "" })).toBe(false);
    expect(validateInstructionsDiagnosticsParams({ sessionKey: "   " })).toBe(false);
    expect(validateInstructionsDiagnosticsParams({ workspaceDir: "   " })).toBe(false);
    expect(validateInstructionsDiagnosticsParams({ bogus: true })).toBe(false);
  });
});