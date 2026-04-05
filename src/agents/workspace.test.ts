import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempWorkspace, writeWorkspaceFile } from "../test-helpers/workspace.js";
import {
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
  DEFAULT_CLAUDE_FILENAME,
  DEFAULT_CLAUDE_LOCAL_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_MEMORY_ALT_FILENAME,
  DEFAULT_MEMORY_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_USER_FILENAME,
  ensureAgentWorkspace,
  filterBootstrapFilesForSession,
  isInstructionBootstrapFile,
  loadWorkspaceBootstrapFiles,
  resolveDefaultAgentWorkspaceDir,
  type WorkspaceBootstrapFile,
} from "./workspace.js";

describe("resolveDefaultAgentWorkspaceDir", () => {
  it("uses OPENCLAW_HOME for default workspace resolution", () => {
    const dir = resolveDefaultAgentWorkspaceDir({
      OPENCLAW_HOME: "/srv/openclaw-home",
      HOME: "/home/other",
    } as NodeJS.ProcessEnv);

    expect(dir).toBe(path.join(path.resolve("/srv/openclaw-home"), ".openclaw", "workspace"));
  });
});

const WORKSPACE_STATE_PATH_SEGMENTS = [".openclaw", "workspace-state.json"] as const;

async function readWorkspaceState(dir: string): Promise<{
  version: number;
  bootstrapSeededAt?: string;
  setupCompletedAt?: string;
}> {
  const raw = await fs.readFile(path.join(dir, ...WORKSPACE_STATE_PATH_SEGMENTS), "utf-8");
  return JSON.parse(raw) as {
    version: number;
    bootstrapSeededAt?: string;
    setupCompletedAt?: string;
  };
}

async function expectBootstrapSeeded(dir: string) {
  await expect(fs.access(path.join(dir, DEFAULT_BOOTSTRAP_FILENAME))).resolves.toBeUndefined();
  const state = await readWorkspaceState(dir);
  expect(state.bootstrapSeededAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
}

async function expectCompletedWithoutBootstrap(dir: string) {
  await expect(fs.access(path.join(dir, DEFAULT_IDENTITY_FILENAME))).resolves.toBeUndefined();
  await expect(fs.access(path.join(dir, DEFAULT_BOOTSTRAP_FILENAME))).rejects.toMatchObject({
    code: "ENOENT",
  });
  const state = await readWorkspaceState(dir);
  expect(state.setupCompletedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
}

function expectSubagentAllowedBootstrapNames(files: WorkspaceBootstrapFile[]) {
  const names = files.map((file) => file.name);
  expect(names).toContain("AGENTS.md");
  expect(names).toContain("CLAUDE.md");
  expect(names).toContain("CLAUDE.local.md");
  expect(names).toContain(".claude/rules/security.md");
  expect(names).toContain("TOOLS.md");
  expect(names).toContain("SOUL.md");
  expect(names).toContain("IDENTITY.md");
  expect(names).toContain("USER.md");
  expect(names).not.toContain("HEARTBEAT.md");
  expect(names).not.toContain("BOOTSTRAP.md");
  expect(names).not.toContain("MEMORY.md");
}

describe("ensureAgentWorkspace", () => {
  it("creates BOOTSTRAP.md and records a seeded marker for brand new workspaces", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");

    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });

    await expectBootstrapSeeded(tempDir);
    expect((await readWorkspaceState(tempDir)).setupCompletedAt).toBeUndefined();
  });

  it("recovers partial initialization by creating BOOTSTRAP.md when marker is missing", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_AGENTS_FILENAME, content: "existing" });

    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });

    await expectBootstrapSeeded(tempDir);
  });

  it("does not recreate BOOTSTRAP.md after completion, even when a core file is recreated", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_IDENTITY_FILENAME, content: "custom" });
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_USER_FILENAME, content: "custom" });
    await fs.unlink(path.join(tempDir, DEFAULT_BOOTSTRAP_FILENAME));
    await fs.unlink(path.join(tempDir, DEFAULT_TOOLS_FILENAME));

    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });

    await expect(fs.access(path.join(tempDir, DEFAULT_BOOTSTRAP_FILENAME))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(fs.access(path.join(tempDir, DEFAULT_TOOLS_FILENAME))).resolves.toBeUndefined();
    const state = await readWorkspaceState(tempDir);
    expect(state.setupCompletedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("does not re-seed BOOTSTRAP.md for legacy completed workspaces without state marker", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_IDENTITY_FILENAME, content: "custom" });
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_USER_FILENAME, content: "custom" });

    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });

    await expect(fs.access(path.join(tempDir, DEFAULT_BOOTSTRAP_FILENAME))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const state = await readWorkspaceState(tempDir);
    expect(state.bootstrapSeededAt).toBeUndefined();
    expect(state.setupCompletedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("treats memory-backed workspaces as existing even when template files are missing", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await fs.mkdir(path.join(tempDir, "memory"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "memory", "2026-02-25.md"), "# Daily log\nSome notes");
    await fs.writeFile(path.join(tempDir, "MEMORY.md"), "# Long-term memory\nImportant stuff");

    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });

    await expect(fs.access(path.join(tempDir, DEFAULT_IDENTITY_FILENAME))).resolves.toBeUndefined();
    await expect(fs.access(path.join(tempDir, DEFAULT_BOOTSTRAP_FILENAME))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const state = await readWorkspaceState(tempDir);
    expect(state.setupCompletedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
    const memoryContent = await fs.readFile(path.join(tempDir, "MEMORY.md"), "utf-8");
    expect(memoryContent).toBe("# Long-term memory\nImportant stuff");
  });

  it("treats git-backed workspaces as existing even when template files are missing", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await fs.mkdir(path.join(tempDir, ".git"), { recursive: true });
    await fs.writeFile(path.join(tempDir, ".git", "HEAD"), "ref: refs/heads/main\n");

    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });

    await expectCompletedWithoutBootstrap(tempDir);
  });

  it("migrates legacy onboardingCompletedAt markers to setupCompletedAt", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await fs.mkdir(path.join(tempDir, ".openclaw"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, ...WORKSPACE_STATE_PATH_SEGMENTS),
      JSON.stringify({
        version: 1,
        onboardingCompletedAt: "2026-03-15T02:30:00.000Z",
      }),
    );

    await ensureAgentWorkspace({ dir: tempDir, ensureBootstrapFiles: true });

    const state = await readWorkspaceState(tempDir);
    expect(state.setupCompletedAt).toBe("2026-03-15T02:30:00.000Z");
    const persisted = await fs.readFile(
      path.join(tempDir, ...WORKSPACE_STATE_PATH_SEGMENTS),
      "utf-8",
    );
    expect(persisted).toContain('"setupCompletedAt": "2026-03-15T02:30:00.000Z"');
  });
});

describe("loadWorkspaceBootstrapFiles", () => {
  const getMemoryEntries = (files: Awaited<ReturnType<typeof loadWorkspaceBootstrapFiles>>) =>
    files.filter((file) =>
      [DEFAULT_MEMORY_FILENAME, DEFAULT_MEMORY_ALT_FILENAME].includes(file.name),
    );

  const getInstructionEntries = (files: Awaited<ReturnType<typeof loadWorkspaceBootstrapFiles>>) =>
    files.filter((file) => isInstructionBootstrapFile(file));

  const expectSingleMemoryEntry = (
    files: Awaited<ReturnType<typeof loadWorkspaceBootstrapFiles>>,
    content: string,
  ) => {
    const memoryEntries = getMemoryEntries(files);
    expect(memoryEntries).toHaveLength(1);
    expect(memoryEntries[0]?.missing).toBe(false);
    expect(memoryEntries[0]?.content).toBe(content);
  };

  it("includes MEMORY.md when present", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await writeWorkspaceFile({ dir: tempDir, name: "MEMORY.md", content: "memory" });

    const files = await loadWorkspaceBootstrapFiles(tempDir);
    expectSingleMemoryEntry(files, "memory");
  });

  it("includes memory.md when MEMORY.md is absent", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await writeWorkspaceFile({ dir: tempDir, name: "memory.md", content: "alt" });

    const files = await loadWorkspaceBootstrapFiles(tempDir);
    expectSingleMemoryEntry(files, "alt");
  });

  it("omits memory entries when no memory files exist", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");

    const files = await loadWorkspaceBootstrapFiles(tempDir);
    expect(getMemoryEntries(files)).toHaveLength(0);
  });

  it("loads CLAUDE.md alongside AGENTS.md when present", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_AGENTS_FILENAME, content: "agents" });
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_CLAUDE_FILENAME, content: "claude" });

    const files = await loadWorkspaceBootstrapFiles(tempDir);
    const instructionEntries = getInstructionEntries(files);

    expect(
      instructionEntries.map((file) => ({ name: file.name, content: file.content, missing: file.missing })),
    ).toEqual([
      { name: DEFAULT_AGENTS_FILENAME, content: "agents", missing: false },
      { name: DEFAULT_CLAUDE_FILENAME, content: "claude", missing: false },
    ]);
  });

  it("falls back to .claude/CLAUDE.md when root CLAUDE.md is absent", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await fs.mkdir(path.join(tempDir, ".claude"), { recursive: true });
    await fs.writeFile(path.join(tempDir, ".claude", DEFAULT_CLAUDE_FILENAME), "nested", "utf-8");

    const files = await loadWorkspaceBootstrapFiles(tempDir);
    const claudeEntries = files.filter((file) => file.name === DEFAULT_CLAUDE_FILENAME);

    expect(claudeEntries).toHaveLength(1);
    expect(claudeEntries[0]?.path).toBe(path.join(tempDir, ".claude", DEFAULT_CLAUDE_FILENAME));
    expect(claudeEntries[0]?.content).toBe("nested");
    expect(claudeEntries[0]?.instructionKind).toBe("claude-project");
    expect(claudeEntries[0]?.instructionLoadMode).toBe("nested-fallback");
  });

  it("loads CLAUDE.local.md after project instruction files", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_CLAUDE_FILENAME, content: "project" });
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_CLAUDE_LOCAL_FILENAME, content: "local" });

    const files = await loadWorkspaceBootstrapFiles(tempDir);
    const instructionEntries = getInstructionEntries(files);

    expect(instructionEntries.map((file) => file.name)).toEqual([
      DEFAULT_CLAUDE_FILENAME,
      DEFAULT_CLAUDE_LOCAL_FILENAME,
    ]);
    expect(instructionEntries[1]?.content).toBe("local");
  });

  it("loads .claude/rules markdown files before CLAUDE.local.md and strips frontmatter", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await fs.mkdir(path.join(tempDir, ".claude", "rules", "nested"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, ".claude", "rules", "01-team.md"),
      "---\ndescription: Team guidance\n---\n## Session Startup\n\nRead team-checklist.md\n",
      "utf-8",
    );
    await fs.writeFile(
      path.join(tempDir, ".claude", "rules", "nested", "02-safety.md"),
      "## Red Lines\n\nNever skip review.\n",
      "utf-8",
    );
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_CLAUDE_LOCAL_FILENAME, content: "## Local\n\nUse test data.\n" });

    const files = await loadWorkspaceBootstrapFiles(tempDir);
    const instructionEntries = getInstructionEntries(files);

    expect(instructionEntries.map((file) => file.name)).toEqual([
      ".claude/rules/01-team.md",
      ".claude/rules/nested/02-safety.md",
      DEFAULT_CLAUDE_LOCAL_FILENAME,
    ]);
    expect(instructionEntries[0]?.content).not.toContain("description: Team guidance");
    expect(instructionEntries[0]?.content).toContain("Read team-checklist.md");
    expect(instructionEntries[0]?.instructionKind).toBe("rule");
    expect(instructionEntries[0]?.instructionLoadMode).toBe("rules-dir");
    expect(instructionEntries[0]?.frontMatterStripped).toBe(true);
  });

  it("routes path-scoped rules only when explicit ruleContextPaths match", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await fs.mkdir(path.join(tempDir, ".claude", "rules"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, ".claude", "rules", "01-api.md"),
      "---\npaths:\n  - src/api/**\n---\n## API Rules\n\nKeep error codes stable.\n",
      "utf-8",
    );
    await fs.writeFile(
      path.join(tempDir, ".claude", "rules", "02-ui.md"),
      "---\npaths:\n  - src/ui/**\n---\n## UI Rules\n\nKeep labels concise.\n",
      "utf-8",
    );

    const files = await loadWorkspaceBootstrapFiles(tempDir, {
      ruleContextPaths: ["src/api/routes.ts"],
    });
    const instructionEntries = getInstructionEntries(files);

    expect(instructionEntries.map((file) => file.name)).toEqual([".claude/rules/01-api.md"]);
    expect(instructionEntries[0]?.rulePaths).toEqual(["src/api/**"]);
    expect(instructionEntries[0]?.matchedRuleContextPaths).toEqual(["src/api/routes.ts"]);
  });

  it("expands workspace-scoped @path imports in instruction files", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await fs.writeFile(path.join(tempDir, "shared.md"), "## Session Startup\n\nRead shared.md\n", "utf-8");
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_CLAUDE_FILENAME, content: "@shared.md" });

    const files = await loadWorkspaceBootstrapFiles(tempDir);
    const claude = files.find((file) => file.name === DEFAULT_CLAUDE_FILENAME);

    expect(claude?.content).toContain("## Session Startup");
    expect(claude?.content).toContain("Read shared.md");
  });

  it("suppresses duplicated imports of root instruction files already loaded separately", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_AGENTS_FILENAME, content: "## Session Startup\n\nRead AGENTS\n" });
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_CLAUDE_FILENAME, content: "@AGENTS.md\n\n## Claude Code\n\nUse plan mode.\n" });

    const files = await loadWorkspaceBootstrapFiles(tempDir);
    const claude = files.find((file) => file.name === DEFAULT_CLAUDE_FILENAME);

    expect(claude?.content).not.toContain("Read AGENTS");
    expect(claude?.content).toContain("## Claude Code");
  });

  it("surfaces import errors for missing files", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_CLAUDE_FILENAME, content: "@missing.md" });

    const files = await loadWorkspaceBootstrapFiles(tempDir);
    const claude = files.find((file) => file.name === DEFAULT_CLAUDE_FILENAME);

    expect(claude?.content).toContain("[IMPORT ERROR] @missing.md -> missing or outside workspace");
  });

  it("surfaces cyclic import errors instead of recursing forever", async () => {
    const tempDir = await makeTempWorkspace("openclaw-workspace-");
    await fs.writeFile(path.join(tempDir, "a.md"), "@b.md", "utf-8");
    await fs.writeFile(path.join(tempDir, "b.md"), "@a.md", "utf-8");
    await writeWorkspaceFile({ dir: tempDir, name: DEFAULT_CLAUDE_FILENAME, content: "@a.md" });

    const files = await loadWorkspaceBootstrapFiles(tempDir);
    const claude = files.find((file) => file.name === DEFAULT_CLAUDE_FILENAME);

    expect(claude?.content).toContain("[IMPORT ERROR] @a.md -> cyclic import");
  });

  it("treats hardlinked bootstrap aliases as missing", async () => {
    if (process.platform === "win32") {
      return;
    }
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-workspace-hardlink-"));
    try {
      const workspaceDir = path.join(rootDir, "workspace");
      const outsideDir = path.join(rootDir, "outside");
      await fs.mkdir(workspaceDir, { recursive: true });
      await fs.mkdir(outsideDir, { recursive: true });
      const outsideFile = path.join(outsideDir, DEFAULT_AGENTS_FILENAME);
      const linkPath = path.join(workspaceDir, DEFAULT_AGENTS_FILENAME);
      await fs.writeFile(outsideFile, "outside", "utf-8");
      try {
        await fs.link(outsideFile, linkPath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "EXDEV") {
          return;
        }
        throw err;
      }

      const files = await loadWorkspaceBootstrapFiles(workspaceDir);
      const agents = files.find((file) => file.name === DEFAULT_AGENTS_FILENAME);
      expect(agents?.missing).toBe(true);
      expect(agents?.content).toBeUndefined();
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});

describe("filterBootstrapFilesForSession", () => {
  const mockFiles: WorkspaceBootstrapFile[] = [
    { name: "AGENTS.md", path: "/w/AGENTS.md", content: "", missing: false },
    { name: "CLAUDE.md", path: "/w/CLAUDE.md", content: "", missing: false },
    { name: "CLAUDE.local.md", path: "/w/CLAUDE.local.md", content: "", missing: false },
    {
      name: ".claude/rules/security.md",
      path: "/w/.claude/rules/security.md",
      content: "",
      missing: false,
      instruction: true,
    },
    { name: "SOUL.md", path: "/w/SOUL.md", content: "", missing: false },
    { name: "TOOLS.md", path: "/w/TOOLS.md", content: "", missing: false },
    { name: "IDENTITY.md", path: "/w/IDENTITY.md", content: "", missing: false },
    { name: "USER.md", path: "/w/USER.md", content: "", missing: false },
    { name: "HEARTBEAT.md", path: "/w/HEARTBEAT.md", content: "", missing: false },
    { name: "BOOTSTRAP.md", path: "/w/BOOTSTRAP.md", content: "", missing: false },
    { name: "MEMORY.md", path: "/w/MEMORY.md", content: "", missing: false },
  ];

  it("returns all files for main session (no sessionKey)", () => {
    const result = filterBootstrapFilesForSession(mockFiles);
    expect(result).toHaveLength(mockFiles.length);
  });

  it("returns all files for normal (non-subagent, non-cron) session key", () => {
    const result = filterBootstrapFilesForSession(mockFiles, "agent:default:chat:main");
    expect(result).toHaveLength(mockFiles.length);
  });

  it("filters to allowlist for subagent sessions", () => {
    const result = filterBootstrapFilesForSession(mockFiles, "agent:default:subagent:task-1");
    expectSubagentAllowedBootstrapNames(result);
  });

  it("filters to allowlist for cron sessions", () => {
    const result = filterBootstrapFilesForSession(mockFiles, "agent:default:cron:daily-check");
    expectSubagentAllowedBootstrapNames(result);
  });
});
