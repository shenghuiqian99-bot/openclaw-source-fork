---
summary: "CLI reference for `openclaw status` (diagnostics, probes, usage snapshots)"
read_when:
  - You want a quick diagnosis of channel health + recent session recipients
  - You want a pasteable “all” status for debugging
title: "status"
---

# `openclaw status`

Diagnostics for channels + sessions.

```bash
openclaw status
openclaw status --all
openclaw status --deep
openclaw status --usage
```

Notes:

- `--deep` runs live probes (WhatsApp Web + Telegram + Discord + Google Chat + Slack + Signal).
- `--deep` also shows the latest known instruction-load diagnostics per agent, sourced from the most recent persisted `systemPromptReport.instructionFiles` in each session store.
- Output includes per-agent session stores when multiple agents are configured.
- Overview includes Gateway + node host service install/runtime status when available.
- Overview includes update channel + git SHA (for source checkouts).
- Update info surfaces in the Overview; if an update is available, status prints a hint to run `openclaw update` (see [Updating](/install/updating)).
- Read-only status surfaces (`status`, `status --json`, `status --all`) resolve supported SecretRefs for their targeted config paths when possible.
- `status --json --deep` and `status --json --all` include an `instructionDiagnostics` block with the latest known per-agent instruction file report, including routed-rule `paths` / `matched` metadata when available.
- If a supported channel SecretRef is configured but unavailable in the current command path, status stays read-only and reports degraded output instead of crashing. Human output shows warnings such as “configured token unavailable in this command path”, and JSON output includes `secretDiagnostics`.
- When command-local SecretRef resolution succeeds, status prefers the resolved snapshot and clears transient “secret unavailable” channel markers from the final output.
- `status --all` includes a Secrets overview row and a diagnosis section that summarizes secret diagnostics (truncated for readability) without stopping report generation.
