import { beforeEach, describe, expect, it, vi } from "vitest";

const noteInstructionDiagnosticsHealth = vi.hoisted(() => vi.fn());

vi.mock("../commands/doctor-instructions.js", () => ({
  noteInstructionDiagnosticsHealth,
}));

import { resolveDoctorHealthContributions } from "./doctor-health-contributions.js";

describe("resolveDoctorHealthContributions", () => {
  beforeEach(() => {
    noteInstructionDiagnosticsHealth.mockClear();
  });

  it("includes and runs the instruction diagnostics contribution", async () => {
    const contribution = resolveDoctorHealthContributions().find(
      (entry) => entry.id === "doctor:instruction-diagnostics",
    );

    expect(contribution).toBeDefined();

    await contribution?.run({ cfg: {} } as never);

    expect(noteInstructionDiagnosticsHealth).toHaveBeenCalledWith({});
  });
});