import type { GatewayBrowserClient } from "../gateway.ts";
import type {
  HealthSnapshot,
  InstructionDiagnosticsFilters,
  InstructionDiagnosticsSummary,
  StatusSummary,
} from "../types.ts";

function buildInstructionDiagnosticsFilters(state: DebugState): InstructionDiagnosticsFilters {
  const agentId = state.debugInstructionDiagnosticsFilterAgentId.trim();
  const sessionKey = state.debugInstructionDiagnosticsFilterSessionKey.trim();
  const workspaceDir = state.debugInstructionDiagnosticsFilterWorkspaceDir.trim();
  return {
    ...(agentId ? { agentId } : {}),
    ...(sessionKey ? { sessionKey } : {}),
    ...(workspaceDir ? { workspaceDir } : {}),
  };
}

export type DebugState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  debugLoading: boolean;
  debugStatus: StatusSummary | null;
  debugInstructionDiagnostics: InstructionDiagnosticsSummary | null;
  debugInstructionDiagnosticsError: string | null;
  debugInstructionDiagnosticsFilterAgentId: string;
  debugInstructionDiagnosticsFilterSessionKey: string;
  debugInstructionDiagnosticsFilterWorkspaceDir: string;
  debugHealth: HealthSnapshot | null;
  debugModels: unknown[];
  debugHeartbeat: unknown;
  debugCallMethod: string;
  debugCallParams: string;
  debugCallResult: string | null;
  debugCallError: string | null;
};

export async function loadDebug(state: DebugState) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.debugLoading) {
    return;
  }
  state.debugLoading = true;
  state.debugInstructionDiagnosticsError = null;
  try {
    const [status, health, models, heartbeat] = await Promise.all([
      state.client.request("status", {}),
      state.client.request("health", {}),
      state.client.request("models.list", {}),
      state.client.request("last-heartbeat", {}),
    ]);
    state.debugStatus = status as StatusSummary;
    state.debugHealth = health as HealthSnapshot;
    const modelPayload = models as { models?: unknown[] } | undefined;
    state.debugModels = Array.isArray(modelPayload?.models) ? modelPayload?.models : [];
    state.debugHeartbeat = heartbeat;

    const filters = buildInstructionDiagnosticsFilters(state);
    const hasFilters = Object.keys(filters).length > 0;
    try {
      const instructionDiagnostics = await state.client.request<InstructionDiagnosticsSummary | undefined>(
        "instructions.diagnostics",
        filters,
      );
      state.debugInstructionDiagnostics = instructionDiagnostics ?? null;
    } catch (err) {
      const statusPayload = status as { instructionDiagnostics?: InstructionDiagnosticsSummary };
      const fallbackDiagnostics = statusPayload?.instructionDiagnostics ?? null;
      if (!hasFilters && fallbackDiagnostics) {
        state.debugInstructionDiagnostics = fallbackDiagnostics;
      } else {
        state.debugInstructionDiagnostics = null;
        state.debugInstructionDiagnosticsError = `Failed to load instruction diagnostics: ${String(err)}`;
      }
    }
  } catch (err) {
    state.debugCallError = String(err);
  } finally {
    state.debugLoading = false;
  }
}

export async function callDebugMethod(state: DebugState) {
  if (!state.client || !state.connected) {
    return;
  }
  state.debugCallError = null;
  state.debugCallResult = null;
  try {
    const params = state.debugCallParams.trim()
      ? (JSON.parse(state.debugCallParams) as unknown)
      : {};
    const res = await state.client.request(state.debugCallMethod.trim(), params);
    state.debugCallResult = JSON.stringify(res, null, 2);
  } catch (err) {
    state.debugCallError = String(err);
  }
}
