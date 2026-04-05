import { html, nothing } from "lit";
import type { EventLogEntry } from "../app-events.ts";
import { formatEventPayload } from "../presenter.ts";
import type { InstructionDiagnosticsFilters } from "../types.ts";

type InstructionDiagnosticsEntry = {
  name?: string;
  path?: string;
  kind?: string;
  loadMode?: string;
  frontMatterStripped?: boolean;
  rulePaths?: string[];
  matchedRuleContextPaths?: string[];
  importErrors?: number;
  missing?: boolean;
  order?: number | null;
};

type InstructionDiagnosticsReport = {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  workspaceDir?: string | null;
  updatedAt?: number | null;
  age?: number | null;
  loaded?: number;
  total?: number;
  missing?: number;
  importErrorCount?: number;
  entries?: InstructionDiagnosticsEntry[];
};

type InstructionDiagnosticsPayload = {
  reports?: number;
  byAgent?: InstructionDiagnosticsReport[];
};

export type DebugProps = {
  loading: boolean;
  status: Record<string, unknown> | null;
  instructionDiagnostics: Record<string, unknown> | null;
  instructionDiagnosticsError: string | null;
  instructionDiagnosticsNotice: string | null;
  instructionDiagnosticsFilterAgentId: string;
  instructionDiagnosticsFilterSessionKey: string;
  instructionDiagnosticsFilterWorkspaceDir: string;
  instructionDiagnosticsExpandedKeys: string[];
  health: Record<string, unknown> | null;
  models: unknown[];
  heartbeat: unknown;
  eventLog: EventLogEntry[];
  methods: string[];
  callMethod: string;
  callParams: string;
  callResult: string | null;
  callError: string | null;
  onInstructionDiagnosticsFilterAgentIdChange: (next: string) => void;
  onInstructionDiagnosticsFilterSessionKeyChange: (next: string) => void;
  onInstructionDiagnosticsFilterWorkspaceDirChange: (next: string) => void;
  onApplyInstructionDiagnosticsFilters: () => void;
  onClearInstructionDiagnosticsFilters: () => void;
  onUseInstructionDiagnosticsInManualRpc: (filters: InstructionDiagnosticsFilters) => void;
  onCallInstructionDiagnosticsInManualRpc: (filters: InstructionDiagnosticsFilters) => void;
  onApplyInstructionDiagnosticsQuickFilter: (filters: InstructionDiagnosticsFilters) => void;
  onCopyInstructionDiagnosticsText: (label: string, text: string) => void;
  onToggleInstructionDiagnosticsReport: (key: string) => void;
  onCallMethodChange: (next: string) => void;
  onCallParamsChange: (next: string) => void;
  onRefresh: () => void;
  onCall: () => void;
};

function extractInstructionDiagnostics(source: Record<string, unknown> | null) {
  if (!source || typeof source !== "object") {
    return null;
  }
  const payload = (source as { instructionDiagnostics?: InstructionDiagnosticsPayload })
    .instructionDiagnostics;
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const byAgent = Array.isArray(payload.byAgent) ? payload.byAgent : [];
  return {
    reports: typeof payload.reports === "number" ? payload.reports : byAgent.length,
    byAgent,
  };
}

function formatInstructionEntryMeta(entry: InstructionDiagnosticsEntry): string {
  const parts: string[] = [];
  if (entry.kind || entry.loadMode) {
    parts.push(`${entry.kind ?? "unknown"}/${entry.loadMode ?? "unknown"}`);
  }
  if (entry.frontMatterStripped) {
    parts.push("frontmatter");
  }
  if (Array.isArray(entry.rulePaths) && entry.rulePaths.length > 0) {
    parts.push(`paths=${entry.rulePaths.join(",")}`);
  }
  if (Array.isArray(entry.matchedRuleContextPaths) && entry.matchedRuleContextPaths.length > 0) {
    parts.push(`matched=${entry.matchedRuleContextPaths.join(",")}`);
  }
  if (typeof entry.importErrors === "number" && entry.importErrors > 0) {
    parts.push(`import=${entry.importErrors}`);
  }
  if (entry.missing) {
    parts.push("missing");
  }
  return parts.join(" · ");
}

function getInstructionDiagnosticsReportKey(report: InstructionDiagnosticsReport, index: number): string {
  if (typeof report.sessionKey === "string" && report.sessionKey.length > 0) {
    return report.sessionKey;
  }
  if (typeof report.agentId === "string" && report.agentId.length > 0) {
    return `${report.agentId}:${index}`;
  }
  return `report:${index}`;
}

function buildActiveInstructionDiagnosticsFilters(props: Pick<
  DebugProps,
  | "instructionDiagnosticsFilterAgentId"
  | "instructionDiagnosticsFilterSessionKey"
  | "instructionDiagnosticsFilterWorkspaceDir"
>): InstructionDiagnosticsFilters {
  const agentId = props.instructionDiagnosticsFilterAgentId.trim();
  const sessionKey = props.instructionDiagnosticsFilterSessionKey.trim();
  const workspaceDir = props.instructionDiagnosticsFilterWorkspaceDir.trim();
  return {
    ...(agentId ? { agentId } : {}),
    ...(sessionKey ? { sessionKey } : {}),
    ...(workspaceDir ? { workspaceDir } : {}),
  };
}

function buildReportInstructionDiagnosticsFilters(
  report: InstructionDiagnosticsReport,
): InstructionDiagnosticsFilters {
  const agentId = typeof report.agentId === "string" ? report.agentId.trim() : "";
  const sessionKey = typeof report.sessionKey === "string" ? report.sessionKey.trim() : "";
  const workspaceDir = typeof report.workspaceDir === "string" ? report.workspaceDir.trim() : "";
  return {
    ...(agentId ? { agentId } : {}),
    ...(sessionKey ? { sessionKey } : {}),
    ...(workspaceDir ? { workspaceDir } : {}),
  };
}

function quoteForPowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildInstructionDiagnosticsCliCommand(params: InstructionDiagnosticsFilters): string {
  return `openclaw gateway call instructions.diagnostics --json --params ${quoteForPowerShell(JSON.stringify(params))}`;
}

export function renderDebug(props: DebugProps) {
  const securityAudit =
    props.status && typeof props.status === "object"
      ? (props.status as { securityAudit?: { summary?: Record<string, number> } }).securityAudit
      : null;
  const securitySummary = securityAudit?.summary ?? null;
  const critical = securitySummary?.critical ?? 0;
  const warn = securitySummary?.warn ?? 0;
  const info = securitySummary?.info ?? 0;
  const securityTone = critical > 0 ? "danger" : warn > 0 ? "warn" : "success";
  const securityLabel =
    critical > 0 ? `${critical} critical` : warn > 0 ? `${warn} warnings` : "No critical issues";
  const activeInstructionDiagnosticsFilters = buildActiveInstructionDiagnosticsFilters(props);
  const activeInstructionDiagnosticsQuery = {
    method: "instructions.diagnostics",
    params: activeInstructionDiagnosticsFilters,
  };
  const activeInstructionDiagnosticsCliCommand = buildInstructionDiagnosticsCliCommand(
    activeInstructionDiagnosticsQuery.params,
  );
  const hasInstructionDiagnosticsFilters = Object.keys(activeInstructionDiagnosticsFilters).length > 0;
  const instructionDiagnostics =
    extractInstructionDiagnostics(
      props.instructionDiagnostics
        ? { instructionDiagnostics: props.instructionDiagnostics }
        : null,
    ) ??
    (!hasInstructionDiagnosticsFilters ? extractInstructionDiagnostics(props.status) : null) ?? {
      reports: 0,
      byAgent: [],
    };

  return html`
    <section class="grid">
      <div class="card">
        <div class="row" style="justify-content: space-between;">
          <div>
            <div class="card-title">Snapshots</div>
            <div class="card-sub">Status, health, and heartbeat data.</div>
          </div>
          <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
            ${props.loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div class="stack" style="margin-top: 12px;">
          <div>
            <div class="muted">Status</div>
            ${securitySummary
              ? html`<div class="callout ${securityTone}" style="margin-top: 8px;">
                  Security audit: ${securityLabel}${info > 0 ? ` · ${info} info` : ""}. Run
                  <span class="mono">openclaw security audit --deep</span> for details.
                </div>`
              : nothing}
            ${html`
                  <div style="margin-top: 12px;">
                    <div class="row" style="justify-content: space-between; gap: 12px; align-items: end; margin-top: 8px;">
                      <div>
                        <div class="muted">Instruction diagnostics</div>
                        <div class="card-sub">Filter the dedicated diagnostics RPC by agent, session, or workspace.</div>
                      </div>
                    </div>
                    <div class="stack" style="margin-top: 8px;">
                      <label class="field">
                        <span>Agent ID</span>
                        <input
                          data-debug-instruction-filter="agentId"
                          .value=${props.instructionDiagnosticsFilterAgentId}
                          @input=${(e: Event) =>
                            props.onInstructionDiagnosticsFilterAgentIdChange(
                              (e.target as HTMLInputElement).value,
                            )}
                          placeholder="main"
                        />
                      </label>
                      <label class="field">
                        <span>Session key</span>
                        <input
                          data-debug-instruction-filter="sessionKey"
                          .value=${props.instructionDiagnosticsFilterSessionKey}
                          @input=${(e: Event) =>
                            props.onInstructionDiagnosticsFilterSessionKeyChange(
                              (e.target as HTMLInputElement).value,
                            )}
                          placeholder="agent:main:main"
                        />
                      </label>
                      <label class="field">
                        <span>Workspace dir</span>
                        <input
                          data-debug-instruction-filter="workspaceDir"
                          .value=${props.instructionDiagnosticsFilterWorkspaceDir}
                          @input=${(e: Event) =>
                            props.onInstructionDiagnosticsFilterWorkspaceDirChange(
                              (e.target as HTMLInputElement).value,
                            )}
                          placeholder="C:\\Users\\name\\.openclaw\\workspace"
                        />
                      </label>
                      <div class="row" style="gap: 8px;">
                        <button
                          class="btn"
                          data-debug-instruction-action="apply"
                          ?disabled=${props.loading}
                          @click=${props.onApplyInstructionDiagnosticsFilters}
                        >
                          ${props.loading ? "Refreshing…" : "Apply filters"}
                        </button>
                        <button
                          class="btn"
                          data-debug-instruction-action="clear"
                          ?disabled=${props.loading && !hasInstructionDiagnosticsFilters}
                          @click=${props.onClearInstructionDiagnosticsFilters}
                        >
                          Clear filters
                        </button>
                        <button
                          class="btn"
                          data-debug-instruction-action="use-rpc"
                          ?disabled=${props.loading}
                          @click=${() =>
                            props.onUseInstructionDiagnosticsInManualRpc(
                              activeInstructionDiagnosticsFilters,
                            )}
                        >
                          Use in Manual RPC
                        </button>
                        <button
                          class="btn"
                          data-debug-instruction-action="call-rpc"
                          ?disabled=${props.loading}
                          @click=${() =>
                            props.onCallInstructionDiagnosticsInManualRpc(
                              activeInstructionDiagnosticsFilters,
                            )}
                        >
                          Call in Manual RPC
                        </button>
                        <button
                          class="btn"
                          data-debug-instruction-action="copy-query"
                          @click=${() =>
                            props.onCopyInstructionDiagnosticsText(
                              "Copied diagnostics query.",
                              JSON.stringify(activeInstructionDiagnosticsQuery, null, 2),
                            )}
                        >
                          Copy query
                        </button>
                        <button
                          class="btn"
                          data-debug-instruction-action="copy-cli"
                          @click=${() =>
                            props.onCopyInstructionDiagnosticsText(
                              "Copied diagnostics CLI command.",
                              activeInstructionDiagnosticsCliCommand,
                            )}
                        >
                          Copy CLI command
                        </button>
                      </div>
                    </div>
                    ${props.instructionDiagnosticsError
                      ? html`<div class="callout danger" style="margin-top: 8px;">${props.instructionDiagnosticsError}</div>`
                      : nothing}
                    ${props.instructionDiagnosticsNotice
                      ? html`<div class="callout" style="margin-top: 8px;">${props.instructionDiagnosticsNotice}</div>`
                      : nothing}
                    ${instructionDiagnostics.byAgent.length === 0
                      ? html`<div class="callout" style="margin-top: 8px;">
                          ${hasInstructionDiagnosticsFilters
                            ? "No persisted instruction diagnostics matched the current filters."
                            : "No persisted instruction diagnostics yet."}
                        </div>`
                      : html`
                          <div class="list" style="margin-top: 8px;">
                            ${instructionDiagnostics.byAgent.map((report, index) => {
                              const entries = Array.isArray(report.entries)
                                ? [...report.entries].sort((left, right) => {
                                    const leftOrder =
                                      typeof left.order === "number"
                                        ? left.order
                                        : Number.MAX_SAFE_INTEGER;
                                    const rightOrder =
                                      typeof right.order === "number"
                                        ? right.order
                                        : Number.MAX_SAFE_INTEGER;
                                    return (
                                      leftOrder - rightOrder ||
                                      (left.name ?? "").localeCompare(right.name ?? "")
                                    );
                                  })
                                : [];
                              const reportKey = getInstructionDiagnosticsReportKey(report, index);
                              const expanded = props.instructionDiagnosticsExpandedKeys.includes(reportKey);
                              const visibleEntries = expanded ? entries : entries.slice(0, 3);
                              const loaded = typeof report.loaded === "number" ? report.loaded : 0;
                              const total = typeof report.total === "number" ? report.total : 0;
                              const missing =
                                typeof report.missing === "number" && report.missing > 0
                                  ? ` · ${report.missing} missing`
                                  : "";
                              const importErrors =
                                typeof report.importErrorCount === "number" &&
                                report.importErrorCount > 0
                                  ? ` · ${report.importErrorCount} import error${report.importErrorCount === 1 ? "" : "s"}`
                                  : "";
                              const toggleLabel =
                                expanded ? "Hide details" : entries.length > 3 ? "Show all" : "Show details";
                              const reportFilters = buildReportInstructionDiagnosticsFilters(report);
                              const reportQuery =
                                Object.keys(reportFilters).length > 0
                                  ? {
                                      method: "instructions.diagnostics",
                                      params: reportFilters,
                                    }
                                  : null;
                              const reportCliCommand = reportQuery
                                ? buildInstructionDiagnosticsCliCommand(reportQuery.params)
                                : null;
                              const copyParams = report.sessionKey
                                ? { sessionKey: report.sessionKey }
                                : report.workspaceDir
                                  ? { workspaceDir: report.workspaceDir }
                                  : report.agentId
                                    ? { agentId: report.agentId }
                                    : null;
                              const quickFilters: Array<{
                                key: string;
                                label: string;
                                filters: InstructionDiagnosticsFilters;
                              }> = [
                                ...(report.agentId
                                  ? [
                                      {
                                        key: "agent",
                                        label: "Use agent",
                                        filters: { agentId: report.agentId },
                                      },
                                    ]
                                  : []),
                                ...(report.sessionKey
                                  ? [
                                      {
                                        key: "session",
                                        label: "Use session",
                                        filters: { sessionKey: report.sessionKey },
                                      },
                                    ]
                                  : []),
                                ...(report.workspaceDir
                                  ? [
                                      {
                                        key: "workspace",
                                        label: "Use workspace",
                                        filters: { workspaceDir: report.workspaceDir },
                                      },
                                    ]
                                  : []),
                              ];
                              return html`
                                <div class="list-item" data-debug-instruction-agent=${report.agentId ?? "unknown"}>
                                  <div class="list-main">
                                    <div class="list-title">
                                      ${report.agentId ?? "unknown"} · ${loaded}/${total} loaded${missing}${importErrors}
                                    </div>
                                    <div class="list-sub">${report.sessionKey ?? "unknown session"}</div>
                                    ${quickFilters.length > 0
                                      ? html`
                                          <div class="row" style="gap: 8px; flex-wrap: wrap; margin-top: 8px;">
                                            ${quickFilters.map(
                                              (quickFilter) => html`
                                                <button
                                                  class="btn"
                                                  data-debug-instruction-quick-filter=${quickFilter.key}
                                                  data-debug-instruction-quick-filter-value=${Object.values(quickFilter.filters)[0] ?? ""}
                                                  ?disabled=${props.loading}
                                                  @click=${() =>
                                                    props.onApplyInstructionDiagnosticsQuickFilter(
                                                      quickFilter.filters,
                                                    )}
                                                >
                                                  ${quickFilter.label}
                                                </button>
                                              `,
                                            )}
                                          </div>
                                        `
                                      : nothing}
                                    ${expanded
                                      ? html`
                                          <div class="muted" style="margin-top: 6px;">
                                            ${report.workspaceDir ? `workspace=${report.workspaceDir}` : ""}
                                            ${report.workspaceDir && report.sessionId ? " · " : ""}
                                            ${report.sessionId ? `sessionId=${report.sessionId}` : ""}
                                          </div>
                                        `
                                      : nothing}
                                  </div>
                                  <div class="list-meta" style="min-width: min(44rem, 100%); text-align: left;">
                                    <div class="row" style="justify-content: flex-end; margin-bottom: 8px;">
                                      ${reportQuery
                                        ? html`
                                            <button
                                              class="btn"
                                              data-debug-instruction-report-focus=${reportKey}
                                              ?disabled=${props.loading}
                                              @click=${() =>
                                                props.onApplyInstructionDiagnosticsQuickFilter(
                                                  reportFilters,
                                                )}
                                            >
                                              Focus report
                                            </button>
                                            <button
                                              class="btn"
                                              data-debug-instruction-report-use=${reportKey}
                                              ?disabled=${props.loading}
                                              @click=${() =>
                                                props.onUseInstructionDiagnosticsInManualRpc(
                                                  reportFilters,
                                                )}
                                            >
                                              Use report in Manual RPC
                                            </button>
                                            <button
                                              class="btn"
                                              data-debug-instruction-report-call=${reportKey}
                                              ?disabled=${props.loading}
                                              @click=${() =>
                                                props.onCallInstructionDiagnosticsInManualRpc(
                                                  reportFilters,
                                                )}
                                            >
                                              Call report in Manual RPC
                                            </button>
                                            <button
                                              class="btn"
                                              data-debug-instruction-copy="report-query"
                                              data-debug-instruction-copy-value=${reportKey}
                                              @click=${() =>
                                                props.onCopyInstructionDiagnosticsText(
                                                  "Copied report query.",
                                                  JSON.stringify(reportQuery, null, 2),
                                                )}
                                            >
                                              Copy report query
                                            </button>
                                            <button
                                              class="btn"
                                              data-debug-instruction-copy="report-cli"
                                              data-debug-instruction-copy-value=${reportKey}
                                              @click=${() =>
                                                props.onCopyInstructionDiagnosticsText(
                                                  "Copied report CLI command.",
                                                  reportCliCommand ?? "",
                                                )}
                                            >
                                              Copy report CLI command
                                            </button>
                                          `
                                        : nothing}
                                      ${copyParams
                                        ? html`
                                            <button
                                              class="btn"
                                              data-debug-instruction-copy="params"
                                              data-debug-instruction-copy-value=${JSON.stringify(copyParams)}
                                              @click=${() =>
                                                props.onCopyInstructionDiagnosticsText(
                                                  "Copied diagnostics params.",
                                                  JSON.stringify(copyParams, null, 2),
                                                )}
                                            >
                                              Copy params
                                            </button>
                                          `
                                        : nothing}
                                      <button
                                        class="btn"
                                        data-debug-instruction-copy="bundle"
                                        data-debug-instruction-copy-value=${reportKey}
                                        @click=${() =>
                                          props.onCopyInstructionDiagnosticsText(
                                            "Copied diagnostics bundle.",
                                            JSON.stringify(
                                              {
                                                method: "instructions.diagnostics",
                                                activeFilters: activeInstructionDiagnosticsFilters,
                                                reportQuery,
                                                reportCliCommand,
                                                reportFilters,
                                                reportKey,
                                                report,
                                              },
                                              null,
                                              2,
                                            ),
                                          )}
                                      >
                                        Copy debug bundle
                                      </button>
                                      <button
                                        class="btn"
                                        data-debug-instruction-copy="report"
                                        data-debug-instruction-copy-value=${reportKey}
                                        @click=${() =>
                                          props.onCopyInstructionDiagnosticsText(
                                            "Copied report JSON.",
                                            JSON.stringify(report, null, 2),
                                          )}
                                      >
                                        Copy report JSON
                                      </button>
                                      <button
                                        class="btn"
                                        data-debug-instruction-toggle=${reportKey}
                                        @click=${() => props.onToggleInstructionDiagnosticsReport(reportKey)}
                                      >
                                        ${toggleLabel}
                                      </button>
                                    </div>
                                    ${visibleEntries.map((entry) => {
                                      const meta = formatInstructionEntryMeta(entry);
                                      return html`
                                        <div style="margin-bottom: 8px;">
                                          <div class="mono">${entry.name ?? "(unnamed)"}</div>
                                          ${expanded && entry.path
                                            ? html`<div class="muted" style="margin-top: 4px;">${entry.path}</div>`
                                            : nothing}
                                          ${meta
                                            ? html`<div class="muted" style="margin-top: 4px;">${meta}</div>`
                                            : nothing}
                                        </div>
                                      `;
                                    })}
                                    ${!expanded && entries.length > 3
                                      ? html`<div class="muted">+${entries.length - 3} more</div>`
                                      : nothing}
                                    ${expanded
                                      ? html`
                                          <details style="margin-top: 8px;">
                                            <summary class="muted" style="cursor: pointer;">Show raw report JSON</summary>
                                            <pre class="code-block" style="margin-top: 8px; max-height: 18rem; overflow: auto;">${JSON.stringify(report, null, 2)}</pre>
                                          </details>
                                        `
                                      : nothing}
                                  </div>
                                </div>
                              `;
                            })}
                          </div>
                        `}
                  </div>
                `}
            <pre class="code-block">${JSON.stringify(props.status ?? {}, null, 2)}</pre>
          </div>
          <div>
            <div class="muted">Health</div>
            <pre class="code-block">${JSON.stringify(props.health ?? {}, null, 2)}</pre>
          </div>
          <div>
            <div class="muted">Last heartbeat</div>
            <pre class="code-block">${JSON.stringify(props.heartbeat ?? {}, null, 2)}</pre>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Manual RPC</div>
        <div class="card-sub">Send a raw gateway method with JSON params.</div>
        <div class="stack" style="margin-top: 16px;">
          <label class="field">
            <span>Method</span>
            <select
              .value=${props.callMethod}
              @change=${(e: Event) =>
                props.onCallMethodChange((e.target as HTMLSelectElement).value)}
            >
              ${!props.callMethod
                ? html` <option value="" disabled>Select a method…</option> `
                : nothing}
              ${props.methods.map((m) => html`<option value=${m}>${m}</option>`)}
            </select>
          </label>
          <label class="field">
            <span>Params (JSON)</span>
            <textarea
              .value=${props.callParams}
              @input=${(e: Event) =>
                props.onCallParamsChange((e.target as HTMLTextAreaElement).value)}
              rows="6"
            ></textarea>
          </label>
        </div>
        <div class="row" style="margin-top: 12px;">
          <button class="btn primary" @click=${props.onCall}>Call</button>
        </div>
        ${props.callError
          ? html`<div class="callout danger" style="margin-top: 12px;">${props.callError}</div>`
          : nothing}
        ${props.callResult
          ? html`<pre class="code-block" style="margin-top: 12px;">${props.callResult}</pre>`
          : nothing}
      </div>
    </section>

    <section class="card" style="margin-top: 18px;">
      <div class="card-title">Models</div>
      <div class="card-sub">Catalog from models.list.</div>
      <pre class="code-block" style="margin-top: 12px;">
${JSON.stringify(props.models ?? [], null, 2)}</pre
      >
    </section>

    <section class="card" style="margin-top: 18px;">
      <div class="card-title">Event Log</div>
      <div class="card-sub">Latest gateway events.</div>
      ${props.eventLog.length === 0
        ? html` <div class="muted" style="margin-top: 12px">No events yet.</div> `
        : html`
            <div class="list debug-event-log" style="margin-top: 12px;">
              ${props.eventLog.map(
                (evt) => html`
                  <div class="list-item debug-event-log__item">
                    <div class="list-main">
                      <div class="list-title">${evt.event}</div>
                      <div class="list-sub">${new Date(evt.ts).toLocaleTimeString()}</div>
                    </div>
                    <div class="list-meta debug-event-log__meta">
                      <pre class="code-block debug-event-log__payload">
${formatEventPayload(evt.payload)}</pre
                      >
                    </div>
                  </div>
                `,
              )}
            </div>
          `}
    </section>
  `;
}
