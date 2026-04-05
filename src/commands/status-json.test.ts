import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RuntimeEnv } from "../runtime.js";

const mocks = vi.hoisted(() => ({
  scanStatusJsonFast: vi.fn(),
  runSecurityAudit: vi.fn(),
  loadProviderUsageSummary: vi.fn(),
  callGateway: vi.fn(),
  getDaemonStatusSummary: vi.fn(),
  getNodeDaemonStatusSummary: vi.fn(),
  normalizeUpdateChannel: vi.fn((value?: string | null) => value ?? null),
  resolveUpdateChannelDisplay: vi.fn(() => ({
    channel: "stable",
    source: "config",
  })),
}));

vi.mock("./status.scan.fast-json.js", () => ({
  scanStatusJsonFast: mocks.scanStatusJsonFast,
}));

vi.mock("../security/audit.runtime.js", () => ({
  runSecurityAudit: mocks.runSecurityAudit,
}));

vi.mock("../infra/provider-usage.js", () => ({
  loadProviderUsageSummary: mocks.loadProviderUsageSummary,
}));

vi.mock("../gateway/call.js", () => ({
  callGateway: mocks.callGateway,
}));

vi.mock("./status.daemon.js", () => ({
  getDaemonStatusSummary: mocks.getDaemonStatusSummary,
  getNodeDaemonStatusSummary: mocks.getNodeDaemonStatusSummary,
}));

vi.mock("../infra/update-channels.js", () => ({
  normalizeUpdateChannel: mocks.normalizeUpdateChannel,
  resolveUpdateChannelDisplay: mocks.resolveUpdateChannelDisplay,
}));

const { statusJsonCommand } = await import("./status-json.js");

function createRuntimeCapture() {
  const logs: string[] = [];
  const runtime: RuntimeEnv = {
    log: vi.fn((value: unknown) => {
      logs.push(String(value));
    }),
    error: vi.fn(),
    exit: vi.fn() as unknown as RuntimeEnv["exit"],
  };
  return { runtime, logs };
}

function createScanResult() {
  return {
    cfg: { update: { channel: "stable" } },
    sourceConfig: {},
    summary: { ok: true, configuredChannels: [] } as Record<string, unknown>,
    osSummary: { platform: "linux" },
    update: { installKind: "npm", git: { tag: null, branch: null } },
    memory: null,
    memoryPlugin: null,
    gatewayMode: "local",
    gatewayConnection: { url: "ws://127.0.0.1:18789", urlSource: "config" },
    remoteUrlMissing: false,
    gatewayReachable: false,
    gatewayProbe: null,
    gatewaySelf: null,
    gatewayProbeAuthWarning: null,
    agentStatus: [],
    secretDiagnostics: [],
  };
}

function createHealthSummary() {
  return {
    ok: true,
    ts: Date.now(),
    durationMs: 9,
    channels: {},
    channelOrder: [],
    channelLabels: {},
    heartbeatSeconds: 1800,
    defaultAgentId: "main",
    agents: [],
    sessions: {
      path: "/tmp/sessions.json",
      count: 1,
      recent: [],
    },
  };
}

describe("statusJsonCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scanStatusJsonFast.mockResolvedValue(createScanResult());
    mocks.runSecurityAudit.mockResolvedValue({
      summary: { critical: 1, warn: 0, info: 0 },
      findings: [],
    });
    mocks.getDaemonStatusSummary.mockResolvedValue({ installed: false });
    mocks.getNodeDaemonStatusSummary.mockResolvedValue({ installed: false });
    mocks.loadProviderUsageSummary.mockResolvedValue({ providers: [] });
    mocks.callGateway.mockResolvedValue({});
  });

  it("keeps plain status --json off the security audit fast path", async () => {
    const { runtime, logs } = createRuntimeCapture();

    await statusJsonCommand({}, runtime);

    expect(mocks.runSecurityAudit).not.toHaveBeenCalled();
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0] ?? "{}")).not.toHaveProperty("securityAudit");
  });

  it("includes security audit details only when --all is requested", async () => {
    const { runtime, logs } = createRuntimeCapture();

    await statusJsonCommand({ all: true }, runtime);

    expect(mocks.runSecurityAudit).toHaveBeenCalledWith({
      config: expect.any(Object),
      sourceConfig: expect.any(Object),
      deep: false,
      includeFilesystem: true,
      includeChannelSecurity: true,
    });
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0] ?? "{}")).toHaveProperty("securityAudit.summary.critical", 1);
  });

  it("includes instruction diagnostics only for deep/all JSON views", async () => {
    const { runtime, logs } = createRuntimeCapture();
    const scan = createScanResult();
    scan.summary.instructionDiagnostics = {
      reports: 1,
      byAgent: [
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
          ],
        },
      ],
    };
    mocks.scanStatusJsonFast.mockResolvedValue(scan);
    mocks.callGateway.mockResolvedValue(createHealthSummary());

    await statusJsonCommand({ deep: true }, runtime);

    const payload = JSON.parse(logs[0] ?? "{}");
    expect(payload.instructionDiagnostics.reports).toBe(1);
    expect(payload.instructionDiagnostics.byAgent[0].agentId).toBe("main");

    const { runtime: plainRuntime, logs: plainLogs } = createRuntimeCapture();
    await statusJsonCommand({}, plainRuntime);
    const plainPayload = JSON.parse(plainLogs[0] ?? "{}");
    expect(plainPayload.instructionDiagnostics).toBeUndefined();
  });
});
