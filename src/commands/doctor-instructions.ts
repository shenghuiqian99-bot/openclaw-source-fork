import type { OpenClawConfig } from "../config/config.js";
import { note } from "../terminal/note.js";
import { collectLatestInstructionDiagnostics } from "./instruction-diagnostics.js";

function formatInstructionEntry(
  entry: ReturnType<typeof collectLatestInstructionDiagnostics>[number]["entries"][number],
): string {
  const detailParts = [`${entry.kind}/${entry.loadMode}`];
  if (entry.frontMatterStripped) {
    detailParts.push("frontmatter");
  }
  if (entry.rulePaths?.length) {
    detailParts.push(`paths=${entry.rulePaths.join(",")}`);
  }
  if (entry.matchedRuleContextPaths?.length) {
    detailParts.push(`matched=${entry.matchedRuleContextPaths.join(",")}`);
  }
  if (entry.importErrors) {
    detailParts.push(`import=${entry.importErrors}`);
  }
  if (entry.missing) {
    detailParts.push("missing");
  }
  return `${entry.name} (${detailParts.join(" ")})`;
}

export function noteInstructionDiagnosticsHealth(cfg: OpenClawConfig) {
  const reports = collectLatestInstructionDiagnostics(cfg);
  if (reports.length === 0) {
    return;
  }

  const lines = ["Latest known persisted instruction diagnostics per agent:"];

  for (const report of reports) {
    const summaryParts = [`${report.agentId}: ${report.loaded}/${report.total} loaded`];
    if (report.missing > 0) {
      summaryParts.push(`${report.missing} missing`);
    }
    if (report.importErrorCount > 0) {
      summaryParts.push(
        `${report.importErrorCount} import error${report.importErrorCount === 1 ? "" : "s"}`,
      );
    }
    summaryParts.push(`session ${report.sessionKey}`);
    lines.push(`- ${summaryParts.join(" · ")}`);

    const orderedEntries = [...report.entries].toSorted((left, right) => {
      const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || left.name.localeCompare(right.name);
    });
    for (const entry of orderedEntries.slice(0, 3)) {
      lines.push(`  - ${formatInstructionEntry(entry)}`);
    }
    if (orderedEntries.length > 3) {
      lines.push(`  - +${orderedEntries.length - 3} more`);
    }
  }

  note(lines.join("\n"), "Instruction diagnostics");
}