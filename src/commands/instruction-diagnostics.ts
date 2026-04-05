import path from "node:path";
import { resolveStorePath } from "../config/sessions/paths.js";
import { readSessionStoreReadOnly } from "../config/sessions/store-read.js";
import type { SessionEntry } from "../config/sessions/types.js";
import type { OpenClawConfig } from "../config/types.js";
import { listGatewayAgentsBasic } from "../gateway/agent-list.js";
import type { StatusInstructionDiagnostics } from "./status.types.js";

export type InstructionDiagnosticsFilters = {
  agentId?: string;
  sessionKey?: string;
  workspaceDir?: string;
};

function normalizeWorkspaceDirForMatch(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = path.normalize(trimmed).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function buildLatestInstructionDiagnosticsFromStore(params: {
  store: Record<string, SessionEntry | undefined>;
  agentId: string;
  now?: number;
  sessionKey?: string;
  workspaceDir?: string;
}): StatusInstructionDiagnostics | null {
  const now = params.now ?? Date.now();
  const workspaceDirMatch = normalizeWorkspaceDirForMatch(params.workspaceDir);
  const reports = Object.entries(params.store)
    .filter(
      ([sessionKey, entry]) =>
        sessionKey !== "global" &&
        sessionKey !== "unknown" &&
        (!params.sessionKey || sessionKey === params.sessionKey) &&
        Array.isArray(entry?.systemPromptReport?.instructionFiles?.entries) &&
        (!workspaceDirMatch ||
          normalizeWorkspaceDirForMatch(entry?.systemPromptReport?.workspaceDir) ===
            workspaceDirMatch),
    )
    .map(([sessionKey, entry]) => {
      const report = entry?.systemPromptReport;
      const instructionFiles = report?.instructionFiles;
      const updatedAt = typeof entry?.updatedAt === "number" ? entry.updatedAt : null;
      return {
        agentId: params.agentId,
        sessionKey,
        sessionId: entry?.sessionId,
        updatedAt,
        age: updatedAt ? now - updatedAt : null,
        generatedAt: report?.generatedAt ?? 0,
        workspaceDir: report?.workspaceDir ?? null,
        total: instructionFiles?.total ?? 0,
        loaded: instructionFiles?.loaded ?? 0,
        missing: instructionFiles?.missing ?? 0,
        importErrorCount: instructionFiles?.importErrorCount ?? 0,
        entries: instructionFiles?.entries ?? [],
      } satisfies StatusInstructionDiagnostics;
    })
    .toSorted((left, right) => {
      const leftTs = left.updatedAt ?? left.generatedAt;
      const rightTs = right.updatedAt ?? right.generatedAt;
      return rightTs - leftTs;
    });

  return reports[0] ?? null;
}

export function collectLatestInstructionDiagnostics(
  cfg: OpenClawConfig,
  now = Date.now(),
  filters: InstructionDiagnosticsFilters = {},
): StatusInstructionDiagnostics[] {
  const agentList = listGatewayAgentsBasic(cfg);
  const diagnostics: StatusInstructionDiagnostics[] = [];
  const agents = filters.agentId
    ? agentList.agents.filter((agent) => agent.id === filters.agentId)
    : agentList.agents;

  for (const agent of agents) {
    const storePath = resolveStorePath(cfg.session?.store, { agentId: agent.id });
    const store = readSessionStoreReadOnly(storePath);
    const latest = buildLatestInstructionDiagnosticsFromStore({
      store,
      agentId: agent.id,
      now,
      sessionKey: filters.sessionKey,
      workspaceDir: filters.workspaceDir,
    });
    if (latest) {
      diagnostics.push(latest);
    }
  }

  return diagnostics;
}