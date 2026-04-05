import syncFs from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { minimatch } from "minimatch";
import { openBoundaryFile } from "../infra/boundary-file-read.js";
import { resolveRequiredHomeDir } from "../infra/home-dir.js";
import { parseFrontmatterBlock } from "../markdown/frontmatter.js";
import { runCommandWithTimeout } from "../process/exec.js";
import { isCronSessionKey, isSubagentSessionKey } from "../routing/session-key.js";
import { resolveUserPath } from "../utils.js";
import { resolveWorkspaceTemplateDir } from "./workspace-templates.js";

export function resolveDefaultAgentWorkspaceDir(
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = os.homedir,
): string {
  const home = resolveRequiredHomeDir(env, homedir);
  const profile = env.OPENCLAW_PROFILE?.trim();
  if (profile && profile.toLowerCase() !== "default") {
    return path.join(home, ".openclaw", `workspace-${profile}`);
  }
  return path.join(home, ".openclaw", "workspace");
}

export const DEFAULT_AGENT_WORKSPACE_DIR = resolveDefaultAgentWorkspaceDir();
export const DEFAULT_AGENTS_FILENAME = "AGENTS.md";
export const DEFAULT_CLAUDE_FILENAME = "CLAUDE.md";
export const DEFAULT_CLAUDE_LOCAL_FILENAME = "CLAUDE.local.md";
export const DEFAULT_SOUL_FILENAME = "SOUL.md";
export const DEFAULT_TOOLS_FILENAME = "TOOLS.md";
export const DEFAULT_IDENTITY_FILENAME = "IDENTITY.md";
export const DEFAULT_USER_FILENAME = "USER.md";
export const DEFAULT_HEARTBEAT_FILENAME = "HEARTBEAT.md";
export const DEFAULT_BOOTSTRAP_FILENAME = "BOOTSTRAP.md";
export const DEFAULT_MEMORY_FILENAME = "MEMORY.md";
export const DEFAULT_MEMORY_ALT_FILENAME = "memory.md";
const DEFAULT_CLAUDE_DIRNAME = ".claude";
const DEFAULT_CLAUDE_RULES_DIRNAME = path.join(DEFAULT_CLAUDE_DIRNAME, "rules");
const WORKSPACE_STATE_DIRNAME = ".openclaw";
const WORKSPACE_STATE_FILENAME = "workspace-state.json";
const WORKSPACE_STATE_VERSION = 1;
const MAX_BOOTSTRAP_IMPORT_DEPTH = 5;
const INSTRUCTION_IMPORT_TOKEN_PATTERN = /(^|[^\S\r\n])@([^\s`]+)/g;

const workspaceTemplateCache = new Map<string, Promise<string>>();
let gitAvailabilityPromise: Promise<boolean> | null = null;
const MAX_WORKSPACE_BOOTSTRAP_FILE_BYTES = 2 * 1024 * 1024;

// File content cache keyed by stable file identity to avoid stale reads.
const workspaceFileCache = new Map<string, { content: string; identity: string }>();

/**
 * Read workspace files via boundary-safe open and cache by inode/dev/size/mtime identity.
 */
type WorkspaceGuardedReadResult =
  | { ok: true; content: string; canonicalPath: string }
  | { ok: false; reason: "path" | "validation" | "io"; error?: unknown };

function workspaceFileIdentity(stat: syncFs.Stats, canonicalPath: string): string {
  return `${canonicalPath}|${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
}

async function readWorkspaceFileWithGuards(params: {
  filePath: string;
  workspaceDir: string;
}): Promise<WorkspaceGuardedReadResult> {
  const opened = await openBoundaryFile({
    absolutePath: params.filePath,
    rootPath: params.workspaceDir,
    boundaryLabel: "workspace root",
    maxBytes: MAX_WORKSPACE_BOOTSTRAP_FILE_BYTES,
  });
  if (!opened.ok) {
    workspaceFileCache.delete(params.filePath);
    return opened;
  }

  const identity = workspaceFileIdentity(opened.stat, opened.path);
  const cached = workspaceFileCache.get(params.filePath);
  if (cached && cached.identity === identity) {
    syncFs.closeSync(opened.fd);
    return { ok: true, content: cached.content, canonicalPath: opened.path };
  }

  try {
    const content = syncFs.readFileSync(opened.fd, "utf-8");
    workspaceFileCache.set(params.filePath, { content, identity });
    return { ok: true, content, canonicalPath: opened.path };
  } catch (error) {
    workspaceFileCache.delete(params.filePath);
    return { ok: false, reason: "io", error };
  } finally {
    syncFs.closeSync(opened.fd);
  }
}

function stripFrontMatter(content: string): string {
  if (!content.startsWith("---")) {
    return content;
  }
  const endIndex = content.indexOf("\n---", 3);
  if (endIndex === -1) {
    return content;
  }
  const start = endIndex + "\n---".length;
  let trimmed = content.slice(start);
  trimmed = trimmed.replace(/^\s+/, "");
  return trimmed;
}

function parseRuleScopePaths(content: string): string[] {
  const raw = parseFrontmatterBlock(content).paths?.trim();
  if (!raw) {
    return [];
  }

  if (raw.startsWith("[")) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .filter((value): value is string => typeof value === "string")
          .map((value) => value.trim().replace(/\\/g, "/"))
          .filter(Boolean);
      }
      if (typeof parsed === "string") {
        const normalized = parsed.trim().replace(/\\/g, "/");
        return normalized ? [normalized] : [];
      }
    } catch {
      // Fall back to treating the raw value as a single glob.
    }
  }

  const normalized = raw.replace(/\\/g, "/");
  return normalized ? [normalized] : [];
}

function normalizeRuleContextPath(input: string, workspaceDir: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const absolute = path.isAbsolute(trimmed)
    ? path.resolve(trimmed)
    : path.resolve(workspaceDir, trimmed);
  const relative = path.relative(workspaceDir, absolute).replace(/\\/g, "/");
  if (!relative || relative.startsWith("../") || path.isAbsolute(relative)) {
    return null;
  }
  return relative;
}

function normalizeRuleContextPaths(paths: string[] | undefined, workspaceDir: string): string[] {
  if (!Array.isArray(paths) || paths.length === 0) {
    return [];
  }
  return Array.from(
    new Set(
      paths
        .map((value) => normalizeRuleContextPath(value, workspaceDir))
        .filter((value): value is string => Boolean(value)),
    ),
  );
}

function normalizeRulePattern(pattern: string): string {
  return pattern.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

function matchRuleContextPaths(rulePaths: string[], contextPaths: string[]): string[] {
  if (rulePaths.length === 0 || contextPaths.length === 0) {
    return [];
  }

  const matched = new Set<string>();
  for (const rulePath of rulePaths) {
    const normalizedPattern = normalizeRulePattern(rulePath);
    if (!normalizedPattern) {
      continue;
    }
    for (const contextPath of contextPaths) {
      if (
        minimatch(contextPath, normalizedPattern, {
          dot: true,
          nocase: process.platform === "win32",
        })
      ) {
        matched.add(contextPath);
      }
    }
  }
  return Array.from(matched);
}

async function loadTemplate(name: string): Promise<string> {
  const cached = workspaceTemplateCache.get(name);
  if (cached) {
    return cached;
  }

  const pending = (async () => {
    const templateDir = await resolveWorkspaceTemplateDir();
    const templatePath = path.join(templateDir, name);
    try {
      const content = await fs.readFile(templatePath, "utf-8");
      return stripFrontMatter(content);
    } catch {
      throw new Error(
        `Missing workspace template: ${name} (${templatePath}). Ensure docs/reference/templates are packaged.`,
      );
    }
  })();

  workspaceTemplateCache.set(name, pending);
  try {
    return await pending;
  } catch (error) {
    workspaceTemplateCache.delete(name);
    throw error;
  }
}

type KnownWorkspaceBootstrapFileName =
  | typeof DEFAULT_AGENTS_FILENAME
  | typeof DEFAULT_CLAUDE_FILENAME
  | typeof DEFAULT_CLAUDE_LOCAL_FILENAME
  | typeof DEFAULT_SOUL_FILENAME
  | typeof DEFAULT_TOOLS_FILENAME
  | typeof DEFAULT_IDENTITY_FILENAME
  | typeof DEFAULT_USER_FILENAME
  | typeof DEFAULT_HEARTBEAT_FILENAME
  | typeof DEFAULT_BOOTSTRAP_FILENAME
  | typeof DEFAULT_MEMORY_FILENAME
  | typeof DEFAULT_MEMORY_ALT_FILENAME;

export type WorkspaceBootstrapFileName = KnownWorkspaceBootstrapFileName | (string & {});

export type WorkspaceInstructionKind =
  | "agents"
  | "claude-project"
  | "claude-local"
  | "rule";

export type WorkspaceInstructionLoadMode =
  | "workspace-root"
  | "nested-fallback"
  | "fallback-default"
  | "rules-dir";

export type WorkspaceBootstrapFile = {
  name: WorkspaceBootstrapFileName;
  path: string;
  content?: string;
  missing: boolean;
  instruction?: boolean;
  instructionKind?: WorkspaceInstructionKind;
  instructionLoadMode?: WorkspaceInstructionLoadMode;
  frontMatterStripped?: boolean;
  rulePaths?: string[];
  matchedRuleContextPaths?: string[];
};

export type WorkspaceBootstrapLoadOptions = {
  ruleContextPaths?: string[];
};

type WorkspaceBootstrapEntry = {
  name: WorkspaceBootstrapFileName;
  filePath: string;
  instruction?: boolean;
  instructionKind?: WorkspaceInstructionKind;
  instructionLoadMode?: WorkspaceInstructionLoadMode;
  stripFrontMatter?: boolean;
};

export type ExtraBootstrapLoadDiagnosticCode =
  | "invalid-bootstrap-filename"
  | "missing"
  | "security"
  | "io";

export type ExtraBootstrapLoadDiagnostic = {
  path: string;
  reason: ExtraBootstrapLoadDiagnosticCode;
  detail: string;
};

type WorkspaceSetupState = {
  version: typeof WORKSPACE_STATE_VERSION;
  bootstrapSeededAt?: string;
  setupCompletedAt?: string;
};

/** Set of recognized bootstrap filenames for runtime validation */
const VALID_BOOTSTRAP_NAMES: ReadonlySet<string> = new Set([
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_CLAUDE_FILENAME,
  DEFAULT_CLAUDE_LOCAL_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_USER_FILENAME,
  DEFAULT_HEARTBEAT_FILENAME,
  DEFAULT_BOOTSTRAP_FILENAME,
  DEFAULT_MEMORY_FILENAME,
  DEFAULT_MEMORY_ALT_FILENAME,
]);

const COMPATIBLE_INSTRUCTION_BOOTSTRAP_NAMES: ReadonlySet<WorkspaceBootstrapFileName> = new Set([
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_CLAUDE_FILENAME,
  DEFAULT_CLAUDE_LOCAL_FILENAME,
]);

export function isInstructionBootstrapFileName(
  name: WorkspaceBootstrapFileName,
): name is
  | typeof DEFAULT_AGENTS_FILENAME
  | typeof DEFAULT_CLAUDE_FILENAME
  | typeof DEFAULT_CLAUDE_LOCAL_FILENAME {
  return COMPATIBLE_INSTRUCTION_BOOTSTRAP_NAMES.has(name);
}

function resolveInstructionKindForBootstrapName(
  name: WorkspaceBootstrapFileName,
): WorkspaceInstructionKind | undefined {
  if (name === DEFAULT_AGENTS_FILENAME) {
    return "agents";
  }
  if (name === DEFAULT_CLAUDE_FILENAME) {
    return "claude-project";
  }
  if (name === DEFAULT_CLAUDE_LOCAL_FILENAME) {
    return "claude-local";
  }
  return undefined;
}

export function isInstructionBootstrapFile(file: WorkspaceBootstrapFile): boolean {
  return file.instruction === true || isInstructionBootstrapFileName(file.name);
}

function isInstructionBootstrapEntry(entry: WorkspaceBootstrapEntry): boolean {
  return entry.instruction === true || isInstructionBootstrapFileName(entry.name);
}

type InstructionImportToken = {
  raw: string;
  spec: string;
  suffix: string;
};

function parseInstructionImportRaw(raw: string): InstructionImportToken | null {
  const spec = raw.replace(/[),.;!?]+$/g, "").trim();
  if (!spec) {
    return null;
  }
  return {
    raw,
    spec,
    suffix: raw.slice(spec.length),
  };
}

function collectInstructionImportTokens(line: string): InstructionImportToken[] {
  const tokens: InstructionImportToken[] = [];
  for (const match of line.matchAll(INSTRUCTION_IMPORT_TOKEN_PATTERN)) {
    const parsed = parseInstructionImportRaw(match[2] ?? "");
    if (parsed) {
      tokens.push(parsed);
    }
  }
  return tokens;
}

function normalizeInstructionImportLine(
  line: string,
  tokens: InstructionImportToken[],
): string {
  if (tokens.length === 0) {
    return line;
  }
  const queue = [...tokens];
  return line.replace(INSTRUCTION_IMPORT_TOKEN_PATTERN, (full, prefix, raw) => {
    const current = queue.shift();
    const parsed = current ?? parseInstructionImportRaw(String(raw ?? ""));
    if (!parsed) {
      return full;
    }
    return `${prefix}${parsed.spec}${parsed.suffix}`;
  });
}

function stripInstructionImportTokens(line: string): string {
  return line.replace(INSTRUCTION_IMPORT_TOKEN_PATTERN, (full, prefix, raw) => {
    const parsed = parseInstructionImportRaw(String(raw ?? ""));
    if (!parsed) {
      return full;
    }
    return prefix;
  });
}

function isImportOnlyLine(line: string): boolean {
  const trimmed = stripInstructionImportTokens(line).trim();
  return trimmed.length === 0 || /^[-*+]\s*$/.test(trimmed);
}

function resolveInstructionImportPath(spec: string, sourcePath: string): string {
  if (spec.startsWith("~")) {
    return resolveUserPath(spec);
  }
  if (path.isAbsolute(spec)) {
    return spec;
  }
  return path.resolve(path.dirname(sourcePath), spec);
}

function formatInstructionImportError(spec: string, reason: string): string {
  return `[IMPORT ERROR] @${spec} -> ${reason}`;
}

async function expandInstructionImports(params: {
  content: string;
  sourcePath: string;
  workspaceDir: string;
  depth: number;
  seenPaths: ReadonlySet<string>;
  suppressPaths?: ReadonlySet<string>;
  rootPath: string;
}): Promise<string> {
  const lines = params.content.split("\n");
  const expandedLines: string[] = [];
  let inCodeBlock = false;

  const loadImportedContent = async (spec: string): Promise<string> => {
    const nextDepth = params.depth + 1;
    if (nextDepth > MAX_BOOTSTRAP_IMPORT_DEPTH) {
      return formatInstructionImportError(
        spec,
        `max depth ${MAX_BOOTSTRAP_IMPORT_DEPTH} exceeded`,
      );
    }

    const resolvedImportPath = resolveInstructionImportPath(spec, params.sourcePath);
    const loaded = await readWorkspaceFileWithGuards({
      filePath: resolvedImportPath,
      workspaceDir: params.workspaceDir,
    });
    if (!loaded.ok) {
      const reason =
        loaded.reason === "path"
          ? "missing or outside workspace"
          : loaded.reason === "validation"
            ? "blocked by workspace boundary"
            : "io error";
      return formatInstructionImportError(spec, reason);
    }

    if (loaded.canonicalPath !== params.rootPath && params.suppressPaths?.has(loaded.canonicalPath)) {
      return "";
    }

    if (params.seenPaths.has(loaded.canonicalPath)) {
      return formatInstructionImportError(spec, "cyclic import");
    }

    return await expandInstructionImports({
      content: loaded.content,
      sourcePath: loaded.canonicalPath,
      workspaceDir: params.workspaceDir,
      depth: nextDepth,
      seenPaths: new Set([...params.seenPaths, loaded.canonicalPath]),
      suppressPaths: params.suppressPaths,
      rootPath: params.rootPath,
    });
  };

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      expandedLines.push(line);
      continue;
    }

    if (inCodeBlock) {
      expandedLines.push(line);
      continue;
    }

    const tokens = collectInstructionImportTokens(line);
    if (tokens.length === 0) {
      expandedLines.push(line);
      continue;
    }

    const normalizedLine = normalizeInstructionImportLine(line, tokens);
    if (!isImportOnlyLine(line)) {
      expandedLines.push(normalizedLine);
    }

    for (const token of tokens) {
      const importedContent = (await loadImportedContent(token.spec)).trimEnd();
      if (!importedContent) {
        continue;
      }
      if (expandedLines.length > 0 && expandedLines[expandedLines.length - 1] !== "") {
        expandedLines.push("");
      }
      expandedLines.push(importedContent);
    }
  }

  return expandedLines.join("\n");
}

async function writeFileIfMissing(filePath: string, content: string): Promise<boolean> {
  try {
    await fs.writeFile(filePath, content, {
      encoding: "utf-8",
      flag: "wx",
    });
    return true;
  } catch (err) {
    const anyErr = err as { code?: string };
    if (anyErr.code !== "EEXIST") {
      throw err;
    }
    return false;
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function toWorkspaceRelativeBootstrapName(filePath: string, workspaceDir: string): string {
  const relative = path.relative(workspaceDir, filePath).replace(/\\/g, "/");
  if (!relative || relative.startsWith("../") || path.isAbsolute(relative)) {
    return path.basename(filePath);
  }
  return relative;
}

async function collectMarkdownFilesRecursively(dirPath: string): Promise<string[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const childPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFilesRecursively(childPath)));
      continue;
    }
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) {
      continue;
    }
    files.push(childPath);
  }

  return files;
}

function resolveWorkspaceStatePath(dir: string): string {
  return path.join(dir, WORKSPACE_STATE_DIRNAME, WORKSPACE_STATE_FILENAME);
}

function parseWorkspaceSetupState(raw: string): WorkspaceSetupState | null {
  try {
    const parsed = JSON.parse(raw) as {
      bootstrapSeededAt?: unknown;
      setupCompletedAt?: unknown;
      onboardingCompletedAt?: unknown;
    };
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const legacyCompletedAt =
      typeof parsed.onboardingCompletedAt === "string" ? parsed.onboardingCompletedAt : undefined;
    return {
      version: WORKSPACE_STATE_VERSION,
      bootstrapSeededAt:
        typeof parsed.bootstrapSeededAt === "string" ? parsed.bootstrapSeededAt : undefined,
      setupCompletedAt:
        typeof parsed.setupCompletedAt === "string" ? parsed.setupCompletedAt : legacyCompletedAt,
    };
  } catch {
    return null;
  }
}

async function readWorkspaceSetupState(statePath: string): Promise<WorkspaceSetupState> {
  try {
    const raw = await fs.readFile(statePath, "utf-8");
    const parsed = parseWorkspaceSetupState(raw);
    if (
      parsed &&
      raw.includes('"onboardingCompletedAt"') &&
      !raw.includes('"setupCompletedAt"') &&
      parsed.setupCompletedAt
    ) {
      await writeWorkspaceSetupState(statePath, parsed);
    }
    return parsed ?? { version: WORKSPACE_STATE_VERSION };
  } catch (err) {
    const anyErr = err as { code?: string };
    if (anyErr.code !== "ENOENT") {
      throw err;
    }
    return {
      version: WORKSPACE_STATE_VERSION,
    };
  }
}

async function readWorkspaceSetupStateForDir(dir: string): Promise<WorkspaceSetupState> {
  const statePath = resolveWorkspaceStatePath(resolveUserPath(dir));
  return await readWorkspaceSetupState(statePath);
}

export async function isWorkspaceSetupCompleted(dir: string): Promise<boolean> {
  const state = await readWorkspaceSetupStateForDir(dir);
  return typeof state.setupCompletedAt === "string" && state.setupCompletedAt.trim().length > 0;
}

async function writeWorkspaceSetupState(
  statePath: string,
  state: WorkspaceSetupState,
): Promise<void> {
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const payload = `${JSON.stringify(state, null, 2)}\n`;
  const tmpPath = `${statePath}.tmp-${process.pid}-${Date.now().toString(36)}`;
  try {
    await fs.writeFile(tmpPath, payload, { encoding: "utf-8" });
    await fs.rename(tmpPath, statePath);
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {});
    throw err;
  }
}

async function hasGitRepo(dir: string): Promise<boolean> {
  try {
    await fs.stat(path.join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}

async function isGitAvailable(): Promise<boolean> {
  if (gitAvailabilityPromise) {
    return gitAvailabilityPromise;
  }

  gitAvailabilityPromise = (async () => {
    try {
      const result = await runCommandWithTimeout(["git", "--version"], { timeoutMs: 2_000 });
      return result.code === 0;
    } catch {
      return false;
    }
  })();

  return gitAvailabilityPromise;
}

async function ensureGitRepo(dir: string, isBrandNewWorkspace: boolean) {
  if (!isBrandNewWorkspace) {
    return;
  }
  if (await hasGitRepo(dir)) {
    return;
  }
  if (!(await isGitAvailable())) {
    return;
  }
  try {
    await runCommandWithTimeout(["git", "init"], { cwd: dir, timeoutMs: 10_000 });
  } catch {
    // Ignore git init failures; workspace creation should still succeed.
  }
}

export async function ensureAgentWorkspace(params?: {
  dir?: string;
  ensureBootstrapFiles?: boolean;
}): Promise<{
  dir: string;
  agentsPath?: string;
  soulPath?: string;
  toolsPath?: string;
  identityPath?: string;
  userPath?: string;
  heartbeatPath?: string;
  bootstrapPath?: string;
}> {
  const rawDir = params?.dir?.trim() ? params.dir.trim() : DEFAULT_AGENT_WORKSPACE_DIR;
  const dir = resolveUserPath(rawDir);
  await fs.mkdir(dir, { recursive: true });

  if (!params?.ensureBootstrapFiles) {
    return { dir };
  }

  const agentsPath = path.join(dir, DEFAULT_AGENTS_FILENAME);
  const soulPath = path.join(dir, DEFAULT_SOUL_FILENAME);
  const toolsPath = path.join(dir, DEFAULT_TOOLS_FILENAME);
  const identityPath = path.join(dir, DEFAULT_IDENTITY_FILENAME);
  const userPath = path.join(dir, DEFAULT_USER_FILENAME);
  const heartbeatPath = path.join(dir, DEFAULT_HEARTBEAT_FILENAME);
  const bootstrapPath = path.join(dir, DEFAULT_BOOTSTRAP_FILENAME);
  const statePath = resolveWorkspaceStatePath(dir);

  const isBrandNewWorkspace = await (async () => {
    const templatePaths = [agentsPath, soulPath, toolsPath, identityPath, userPath, heartbeatPath];
    const userContentPaths = [
      path.join(dir, "memory"),
      path.join(dir, DEFAULT_MEMORY_FILENAME),
      path.join(dir, ".git"),
    ];
    const paths = [...templatePaths, ...userContentPaths];
    const existing = await Promise.all(
      paths.map(async (p) => {
        try {
          await fs.access(p);
          return true;
        } catch {
          return false;
        }
      }),
    );
    return existing.every((v) => !v);
  })();

  const agentsTemplate = await loadTemplate(DEFAULT_AGENTS_FILENAME);
  const soulTemplate = await loadTemplate(DEFAULT_SOUL_FILENAME);
  const toolsTemplate = await loadTemplate(DEFAULT_TOOLS_FILENAME);
  const identityTemplate = await loadTemplate(DEFAULT_IDENTITY_FILENAME);
  const userTemplate = await loadTemplate(DEFAULT_USER_FILENAME);
  const heartbeatTemplate = await loadTemplate(DEFAULT_HEARTBEAT_FILENAME);
  await writeFileIfMissing(agentsPath, agentsTemplate);
  await writeFileIfMissing(soulPath, soulTemplate);
  await writeFileIfMissing(toolsPath, toolsTemplate);
  await writeFileIfMissing(identityPath, identityTemplate);
  await writeFileIfMissing(userPath, userTemplate);
  await writeFileIfMissing(heartbeatPath, heartbeatTemplate);

  let state = await readWorkspaceSetupState(statePath);
  let stateDirty = false;
  const markState = (next: Partial<WorkspaceSetupState>) => {
    state = { ...state, ...next };
    stateDirty = true;
  };
  const nowIso = () => new Date().toISOString();

  let bootstrapExists = await fileExists(bootstrapPath);
  if (!state.bootstrapSeededAt && bootstrapExists) {
    markState({ bootstrapSeededAt: nowIso() });
  }

  if (!state.setupCompletedAt && state.bootstrapSeededAt && !bootstrapExists) {
    markState({ setupCompletedAt: nowIso() });
  }

  if (!state.bootstrapSeededAt && !state.setupCompletedAt && !bootstrapExists) {
    // Legacy migration path: if USER/IDENTITY diverged from templates, or if user-content
    // indicators exist, treat setup as complete and avoid recreating BOOTSTRAP for
    // already-configured workspaces.
    const [identityContent, userContent] = await Promise.all([
      fs.readFile(identityPath, "utf-8"),
      fs.readFile(userPath, "utf-8"),
    ]);
    const hasUserContent = await (async () => {
      const indicators = [
        path.join(dir, "memory"),
        path.join(dir, DEFAULT_MEMORY_FILENAME),
        path.join(dir, ".git"),
      ];
      for (const indicator of indicators) {
        try {
          await fs.access(indicator);
          return true;
        } catch {
          // continue
        }
      }
      return false;
    })();
    const legacySetupCompleted =
      identityContent !== identityTemplate || userContent !== userTemplate || hasUserContent;
    if (legacySetupCompleted) {
      markState({ setupCompletedAt: nowIso() });
    } else {
      const bootstrapTemplate = await loadTemplate(DEFAULT_BOOTSTRAP_FILENAME);
      const wroteBootstrap = await writeFileIfMissing(bootstrapPath, bootstrapTemplate);
      if (!wroteBootstrap) {
        bootstrapExists = await fileExists(bootstrapPath);
      } else {
        bootstrapExists = true;
      }
      if (bootstrapExists && !state.bootstrapSeededAt) {
        markState({ bootstrapSeededAt: nowIso() });
      }
    }
  }

  if (stateDirty) {
    await writeWorkspaceSetupState(statePath, state);
  }
  await ensureGitRepo(dir, isBrandNewWorkspace);

  return {
    dir,
    agentsPath,
    soulPath,
    toolsPath,
    identityPath,
    userPath,
    heartbeatPath,
    bootstrapPath,
  };
}

async function resolveMemoryBootstrapEntry(
  resolvedDir: string,
): Promise<{ name: WorkspaceBootstrapFileName; filePath: string } | null> {
  // Prefer MEMORY.md; fall back to memory.md only when absent.
  // Checking both and deduplicating via realpath is unreliable on case-insensitive
  // file systems mounted in Docker (e.g. macOS volumes), where both names pass
  // fs.access() but realpath does not normalise case through the mount layer,
  // causing the same content to be injected twice and wasting tokens.
  for (const name of [DEFAULT_MEMORY_FILENAME, DEFAULT_MEMORY_ALT_FILENAME] as const) {
    const filePath = path.join(resolvedDir, name);
    try {
      await fs.access(filePath);
      return { name, filePath };
    } catch {
      // try next candidate
    }
  }
  return null;
}

async function resolveInstructionBootstrapEntries(
  resolvedDir: string,
): Promise<WorkspaceBootstrapEntry[]> {
  const entries: WorkspaceBootstrapEntry[] = [];

  const agentsPath = path.join(resolvedDir, DEFAULT_AGENTS_FILENAME);
  if (await fileExists(agentsPath)) {
    entries.push({
      name: DEFAULT_AGENTS_FILENAME,
      filePath: agentsPath,
      instruction: true,
      instructionKind: "agents",
      instructionLoadMode: "workspace-root",
    });
  }

  const claudePath = path.join(resolvedDir, DEFAULT_CLAUDE_FILENAME);
  const nestedClaudePath = path.join(resolvedDir, DEFAULT_CLAUDE_DIRNAME, DEFAULT_CLAUDE_FILENAME);
  if (await fileExists(claudePath)) {
    entries.push({
      name: DEFAULT_CLAUDE_FILENAME,
      filePath: claudePath,
      instruction: true,
      instructionKind: "claude-project",
      instructionLoadMode: "workspace-root",
    });
  } else if (await fileExists(nestedClaudePath)) {
    entries.push({
      name: DEFAULT_CLAUDE_FILENAME,
      filePath: nestedClaudePath,
      instruction: true,
      instructionKind: "claude-project",
      instructionLoadMode: "nested-fallback",
    });
  }

  const claudeRulesDir = path.join(resolvedDir, DEFAULT_CLAUDE_RULES_DIRNAME);
  if (await directoryExists(claudeRulesDir)) {
    const ruleFiles = await collectMarkdownFilesRecursively(claudeRulesDir);
    ruleFiles.sort((left, right) => left.localeCompare(right));
    entries.push(
      ...ruleFiles.map<WorkspaceBootstrapEntry>((filePath) => ({
        name: toWorkspaceRelativeBootstrapName(filePath, resolvedDir),
        filePath,
        instruction: true,
        instructionKind: "rule",
        instructionLoadMode: "rules-dir",
        stripFrontMatter: true,
      })),
    );
  }

  const claudeLocalPath = path.join(resolvedDir, DEFAULT_CLAUDE_LOCAL_FILENAME);
  if (await fileExists(claudeLocalPath)) {
    entries.push({
      name: DEFAULT_CLAUDE_LOCAL_FILENAME,
      filePath: claudeLocalPath,
      instruction: true,
      instructionKind: "claude-local",
      instructionLoadMode: "workspace-root",
    });
  }

  if (entries.length === 0) {
    entries.push({
      name: DEFAULT_AGENTS_FILENAME,
      filePath: agentsPath,
      instruction: true,
      instructionKind: "agents",
      instructionLoadMode: "fallback-default",
    });
  }

  return entries;
}

export async function loadWorkspaceBootstrapFiles(
  dir: string,
  options?: WorkspaceBootstrapLoadOptions,
): Promise<WorkspaceBootstrapFile[]> {
  const resolvedDir = resolveUserPath(dir);
  const normalizedRuleContextPaths = normalizeRuleContextPaths(options?.ruleContextPaths, resolvedDir);
  const routeRulesByPath = normalizedRuleContextPaths.length > 0;

  const entries: WorkspaceBootstrapEntry[] = [
    ...(await resolveInstructionBootstrapEntries(resolvedDir)),
    {
      name: DEFAULT_SOUL_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_SOUL_FILENAME),
    },
    {
      name: DEFAULT_TOOLS_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_TOOLS_FILENAME),
    },
    {
      name: DEFAULT_IDENTITY_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_IDENTITY_FILENAME),
    },
    {
      name: DEFAULT_USER_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_USER_FILENAME),
    },
    {
      name: DEFAULT_HEARTBEAT_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_HEARTBEAT_FILENAME),
    },
    {
      name: DEFAULT_BOOTSTRAP_FILENAME,
      filePath: path.join(resolvedDir, DEFAULT_BOOTSTRAP_FILENAME),
    },
  ];

  const memoryEntry = await resolveMemoryBootstrapEntry(resolvedDir);
  if (memoryEntry) {
    entries.push(memoryEntry);
  }

  const loadedEntries = await Promise.all(
    entries.map(async (entry) => ({
      entry,
      loaded: await readWorkspaceFileWithGuards({
        filePath: entry.filePath,
        workspaceDir: resolvedDir,
      }),
    })),
  );

  const preparedEntries = loadedEntries.map(({ entry, loaded }) => {
    const instruction = isInstructionBootstrapEntry(entry);
    if (!loaded.ok || entry.instructionKind !== "rule" || !routeRulesByPath) {
      return {
        entry,
        loaded,
        instruction,
        include: true,
        rulePaths: undefined as string[] | undefined,
        matchedRuleContextPaths: undefined as string[] | undefined,
      };
    }

    const rulePaths = parseRuleScopePaths(loaded.content);
    if (rulePaths.length === 0) {
      return {
        entry,
        loaded,
        instruction,
        include: true,
        rulePaths: undefined as string[] | undefined,
        matchedRuleContextPaths: undefined as string[] | undefined,
      };
    }

    const matchedRuleContextPaths = matchRuleContextPaths(rulePaths, normalizedRuleContextPaths);
    return {
      entry,
      loaded,
      instruction,
      include: matchedRuleContextPaths.length > 0,
      rulePaths,
      matchedRuleContextPaths,
    };
  });

  const rootInstructionPaths = new Set(
    preparedEntries
      .filter(({ instruction, include, loaded }) => instruction && include && loaded.ok)
      .map(({ loaded }) => (loaded.ok ? loaded.canonicalPath : ""))
      .filter((value) => value.length > 0),
  );

  const result: WorkspaceBootstrapFile[] = [];
  for (const prepared of preparedEntries) {
    const { entry, loaded, instruction, include, rulePaths, matchedRuleContextPaths } = prepared;
    if (!include) {
      continue;
    }
    if (loaded.ok) {
      const sourceContent = entry.stripFrontMatter ? stripFrontMatter(loaded.content) : loaded.content;
      const frontMatterStripped = entry.stripFrontMatter === true && sourceContent !== loaded.content;
      const content = instruction
        ? await expandInstructionImports({
            content: sourceContent,
            sourcePath: loaded.canonicalPath,
            workspaceDir: resolvedDir,
            depth: 0,
            seenPaths: new Set([loaded.canonicalPath]),
            suppressPaths: rootInstructionPaths,
            rootPath: loaded.canonicalPath,
          })
        : sourceContent;
      result.push({
        name: entry.name,
        path: entry.filePath,
        content,
        missing: false,
        instruction,
        instructionKind: entry.instructionKind,
        instructionLoadMode: entry.instructionLoadMode,
        ...(frontMatterStripped ? { frontMatterStripped: true } : {}),
        ...(rulePaths?.length ? { rulePaths } : {}),
        ...(matchedRuleContextPaths?.length ? { matchedRuleContextPaths } : {}),
      });
    } else {
      result.push({
        name: entry.name,
        path: entry.filePath,
        missing: true,
        instruction,
        instructionKind: entry.instructionKind,
        instructionLoadMode: entry.instructionLoadMode,
      });
    }
  }
  return result;
}

const MINIMAL_BOOTSTRAP_ALLOWLIST = new Set([
  DEFAULT_AGENTS_FILENAME,
  DEFAULT_CLAUDE_FILENAME,
  DEFAULT_CLAUDE_LOCAL_FILENAME,
  DEFAULT_TOOLS_FILENAME,
  DEFAULT_SOUL_FILENAME,
  DEFAULT_IDENTITY_FILENAME,
  DEFAULT_USER_FILENAME,
]);

export function filterBootstrapFilesForSession(
  files: WorkspaceBootstrapFile[],
  sessionKey?: string,
): WorkspaceBootstrapFile[] {
  if (!sessionKey || (!isSubagentSessionKey(sessionKey) && !isCronSessionKey(sessionKey))) {
    return files;
  }
  return files.filter((file) => file.instruction === true || MINIMAL_BOOTSTRAP_ALLOWLIST.has(file.name));
}

export async function loadExtraBootstrapFiles(
  dir: string,
  extraPatterns: string[],
): Promise<WorkspaceBootstrapFile[]> {
  const loaded = await loadExtraBootstrapFilesWithDiagnostics(dir, extraPatterns);
  return loaded.files;
}

export async function loadExtraBootstrapFilesWithDiagnostics(
  dir: string,
  extraPatterns: string[],
): Promise<{
  files: WorkspaceBootstrapFile[];
  diagnostics: ExtraBootstrapLoadDiagnostic[];
}> {
  if (!extraPatterns.length) {
    return { files: [], diagnostics: [] };
  }
  const resolvedDir = resolveUserPath(dir);

  // Resolve glob patterns into concrete file paths
  const resolvedPaths = new Set<string>();
  for (const pattern of extraPatterns) {
    if (pattern.includes("*") || pattern.includes("?") || pattern.includes("{")) {
      try {
        const matches = fs.glob(pattern, { cwd: resolvedDir });
        for await (const m of matches) {
          resolvedPaths.add(m);
        }
      } catch {
        // glob not available or pattern error — fall back to literal
        resolvedPaths.add(pattern);
      }
    } else {
      resolvedPaths.add(pattern);
    }
  }

  const files: WorkspaceBootstrapFile[] = [];
  const diagnostics: ExtraBootstrapLoadDiagnostic[] = [];
  const loadedEntries: Array<{
    baseName: string;
    filePath: string;
    loaded: WorkspaceGuardedReadResult;
    instruction: boolean;
  }> = [];
  for (const relPath of resolvedPaths) {
    const filePath = path.resolve(resolvedDir, relPath);
    // Only load files whose basename is a recognized bootstrap filename
    const baseName = path.basename(relPath);
    if (!VALID_BOOTSTRAP_NAMES.has(baseName)) {
      diagnostics.push({
        path: filePath,
        reason: "invalid-bootstrap-filename",
        detail: `unsupported bootstrap basename: ${baseName}`,
      });
      continue;
    }
    const loaded = await readWorkspaceFileWithGuards({
      filePath,
      workspaceDir: resolvedDir,
    });
    loadedEntries.push({
      baseName,
      filePath,
      loaded,
      instruction: isInstructionBootstrapFileName(baseName as WorkspaceBootstrapFileName),
    });
  }

  const rootInstructionPaths = new Set(
    loadedEntries
      .filter(({ instruction, loaded }) => instruction && loaded.ok)
      .map(({ loaded }) => (loaded.ok ? loaded.canonicalPath : ""))
      .filter((value) => value.length > 0),
  );

  for (const { baseName, filePath, loaded, instruction } of loadedEntries) {
    if (loaded.ok) {
      const bootstrapName = baseName as WorkspaceBootstrapFileName;
      const content = instruction
        ? await expandInstructionImports({
            content: loaded.content,
            sourcePath: loaded.canonicalPath,
            workspaceDir: resolvedDir,
            depth: 0,
            seenPaths: new Set([loaded.canonicalPath]),
            suppressPaths: rootInstructionPaths,
            rootPath: loaded.canonicalPath,
          })
        : loaded.content;
      files.push({
        name: bootstrapName,
        path: filePath,
        content,
        missing: false,
        instruction,
        instructionKind: instruction
          ? resolveInstructionKindForBootstrapName(bootstrapName)
          : undefined,
      });
      continue;
    }

    const reason: ExtraBootstrapLoadDiagnosticCode =
      loaded.reason === "path" ? "missing" : loaded.reason === "validation" ? "security" : "io";
    diagnostics.push({
      path: filePath,
      reason,
      detail:
        loaded.error instanceof Error
          ? loaded.error.message
          : typeof loaded.error === "string"
            ? loaded.error
            : reason,
    });
  }
  return { files, diagnostics };
}
