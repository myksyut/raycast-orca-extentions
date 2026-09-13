import { getPreferenceValues } from "@raycast/api";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const DEFAULT_ORCA_CLI = "/Applications/Orca.app/Contents/Resources/bin/orca";
export const ORCA_BUNDLE_ID = "com.stablyai.orca";

interface Preferences {
  orcaPath?: string;
  defaultAgent?: string;
  showArchived?: boolean;
}

export function getPrefs(): Required<Preferences> {
  const prefs = getPreferenceValues<Preferences>();
  return {
    orcaPath: prefs.orcaPath?.trim() || DEFAULT_ORCA_CLI,
    defaultAgent: prefs.defaultAgent || "claude",
    showArchived: prefs.showArchived ?? false,
  };
}

// ---------------------------------------------------------------------------
// Types (shapes returned by `orca ... --json`)
// ---------------------------------------------------------------------------

export type AgentState =
  "working" | "running" | "attention" | "blocked" | "waiting" | "idle" | "done" | "error" | string;

export interface PsAgent {
  paneKey: string;
  parentPaneKey: string | null;
  state: AgentState;
  agentType: string;
  prompt: string | null;
  taskTitle: string | null;
  displayName: string | null;
  lastAssistantMessage: string | null;
  toolName: string | null;
  toolInput: string | null;
  interrupted: boolean;
  stateStartedAt: number;
  updatedAt: number;
}

export interface Session {
  workspaceKind: string;
  worktreeId: string;
  repoId: string;
  hostId: string;
  repo: string;
  path: string;
  branch: string | null;
  isArchived: boolean;
  isMainWorktree: boolean;
  worktreeInstanceId: string;
  parentWorktreeId: string | null;
  childWorktreeIds: string[];
  displayName: string;
  workspaceStatus: string;
  sortOrder: number;
  lastActivityAt: number;
  createdAt: number;
  linkedIssue: number | string | null;
  linkedPR: number | string | null;
  linkedLinearIssue: string | null;
  comment: string;
  isPinned: boolean;
  isActive: boolean;
  unread: boolean;
  liveTerminalCount: number;
  hasAttachedPty: boolean;
  lastOutputAt: number | null;
  preview: string | null;
  status: AgentState | null;
  agents: PsAgent[];
}

export interface Terminal {
  handle: string;
  ptyId: string;
  orphaned: boolean;
  worktreeId: string;
  worktreePath: string;
  branch: string | null;
  tabId: string;
  leafId: string;
  title: string;
  connected: boolean;
  writable: boolean;
  lastOutputAt: number | null;
  preview: string | null;
  executionHostId: string;
  agentIdentity: string | null;
}

export interface Repo {
  id: string;
  path: string;
  displayName: string;
  badgeColor: string;
  kind: string;
}

export interface TerminalRead {
  handle: string;
  status: string;
  tail: string[];
  truncated: boolean;
  nextCursor?: string;
  source?: string;
}

export interface RuntimeStatus {
  target?: { kind: string };
  app: { running: boolean; pid?: number; desktopWindowStatus?: string };
  runtime: { state: string; reachable: boolean; connectionState?: string; runtimeId?: string; appVersion?: string };
  graph?: { state: string };
}

interface Envelope<T> {
  id: string;
  ok: boolean;
  result?: T;
  error?: { code: string; message: string; data?: Record<string, unknown> };
}

export class OrcaError extends Error {
  code: string;
  data?: Record<string, unknown>;
  constructor(code: string, message: string, data?: Record<string, unknown>) {
    super(message);
    this.name = "OrcaError";
    this.code = code;
    this.data = data;
  }
}

// ---------------------------------------------------------------------------
// Low-level runner
// ---------------------------------------------------------------------------

function humanize(code: string, data?: Record<string, unknown>): string {
  const steps = data?.nextSteps;
  if (Array.isArray(steps) && steps.length > 0) return String(steps[0]);
  switch (code) {
    case "terminal_handle_stale":
      return "That terminal is gone. Refresh the list.";
    case "selector_not_found":
      return "Worktree not found. It may have been removed.";
    case "runtime_unreachable":
    case "runtime_not_running":
      return "Orca is not running. Open Orca first.";
    default:
      return code.replace(/_/g, " ");
  }
}

export async function runOrca<T>(args: string[], options: { timeoutMs?: number } = {}): Promise<T> {
  const { orcaPath } = getPrefs();
  if (!existsSync(orcaPath)) {
    throw new OrcaError("cli_missing", `Orca CLI not found at ${orcaPath}. Set the path in the extension preferences.`);
  }
  let stdout = "";
  try {
    const res = await execFileAsync(orcaPath, [...args, "--json"], {
      maxBuffer: 32 * 1024 * 1024,
      timeout: options.timeoutMs ?? 20_000,
      env: { ...process.env, PATH: `${process.env.PATH ?? ""}:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin` },
    });
    stdout = res.stdout;
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stdout?: string; stderr?: string; killed?: boolean };
    // Non-zero exit still carries the JSON envelope on stdout.
    if (err.stdout && err.stdout.trim().startsWith("{")) {
      stdout = err.stdout;
    } else if (err.killed) {
      throw new OrcaError("timeout", "Orca CLI timed out. Is Orca running?");
    } else {
      const detail = (err.stderr || err.message || "").trim().split("\n").pop() ?? "";
      throw new OrcaError("cli_failed", detail || "Orca CLI failed");
    }
  }
  let parsed: Envelope<T>;
  try {
    parsed = JSON.parse(stdout) as Envelope<T>;
  } catch {
    throw new OrcaError("bad_json", stdout.trim().split("\n").pop() ?? "Unexpected Orca CLI output");
  }
  if (!parsed.ok || parsed.result === undefined) {
    const code = parsed.error?.code ?? "unknown";
    throw new OrcaError(code, humanize(code, parsed.error?.data), parsed.error?.data);
  }
  return parsed.result;
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

export function worktreeSelector(session: Pick<Session, "path">): string {
  return `path:${session.path}`;
}

export function agentPaneKey(terminal: Pick<Terminal, "tabId" | "leafId">): string {
  return `${terminal.tabId}:${terminal.leafId}`;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export async function getStatus(): Promise<RuntimeStatus> {
  return runOrca<RuntimeStatus>(["status"], { timeoutMs: 8_000 });
}

export async function listSessions(): Promise<Session[]> {
  const res = await runOrca<{ worktrees: Session[] }>(["worktree", "ps", "--limit", "500"]);
  return res.worktrees ?? [];
}

export async function listTerminals(session?: Pick<Session, "path">): Promise<Terminal[]> {
  const args = ["terminal", "list", "--limit", "500"];
  if (session) args.push("--worktree", worktreeSelector(session));
  const res = await runOrca<{ terminals: Terminal[] }>(args);
  return res.terminals ?? [];
}

export async function listRepos(): Promise<Repo[]> {
  const res = await runOrca<{ repos: Repo[] }>(["repo", "list"]);
  return res.repos ?? [];
}

export async function switchTerminal(handle: string): Promise<void> {
  await runOrca(["terminal", "switch", "--terminal", handle]);
}

export async function sendToTerminal(
  handle: string,
  opts: { text?: string; enter?: boolean; interrupt?: boolean },
): Promise<unknown> {
  const args = ["terminal", "send", "--terminal", handle];
  if (opts.text !== undefined) args.push("--text", opts.text);
  if (opts.enter) args.push("--enter");
  if (opts.interrupt) args.push("--interrupt");
  return runOrca(args);
}

export async function readTerminal(
  handle: string,
  opts: { screen?: boolean; limit?: number } = {},
): Promise<TerminalRead> {
  const args = ["terminal", "read", "--terminal", handle, "--limit", String(opts.limit ?? 200)];
  if (opts.screen) args.push("--screen");
  const res = await runOrca<{ terminal: TerminalRead }>(args);
  return res.terminal;
}

export async function createTerminal(opts: {
  session: Pick<Session, "path">;
  command?: string;
  title?: string;
  focus?: boolean;
}): Promise<{ handle?: string }> {
  const args = ["terminal", "create", "--worktree", worktreeSelector(opts.session)];
  if (opts.command) args.push("--command", opts.command);
  if (opts.title) args.push("--title", opts.title);
  if (opts.focus) args.push("--focus");
  const res = await runOrca<{ terminal?: { handle?: string }; handle?: string }>(args);
  return { handle: res.terminal?.handle ?? res.handle };
}

export async function closeTerminal(handle: string, wholeTab = false): Promise<void> {
  const args = ["terminal", "close", "--terminal", handle];
  if (wholeTab) args.push("--tab");
  await runOrca(args);
}

export async function closeAllTerminals(session: Pick<Session, "path">): Promise<void> {
  await runOrca(["terminal", "close", "--worktree", worktreeSelector(session), "--all"]);
}

export interface CreateWorktreeInput {
  name: string;
  repoId?: string;
  agent?: string;
  prompt?: string;
  baseBranch?: string;
  comment?: string;
  activate?: boolean;
  noParent?: boolean;
}

export async function createWorktree(input: CreateWorktreeInput): Promise<Record<string, unknown>> {
  const args = ["worktree", "create", "--name", input.name];
  if (input.repoId) args.push("--repo", `id:${input.repoId}`);
  if (input.agent) args.push("--agent", input.agent);
  if (input.prompt?.trim()) args.push("--prompt", input.prompt);
  if (input.baseBranch?.trim()) args.push("--base-branch", input.baseBranch.trim());
  if (input.comment?.trim()) args.push("--comment", input.comment.trim());
  if (input.activate) args.push("--activate");
  if (input.noParent) args.push("--no-parent");
  return runOrca<Record<string, unknown>>(args, { timeoutMs: 120_000 });
}

export async function removeWorktree(session: Pick<Session, "path">, force = false): Promise<void> {
  const args = ["worktree", "rm", "--worktree", worktreeSelector(session)];
  if (force) args.push("--force");
  await runOrca(args, { timeoutMs: 60_000 });
}

export async function setWorktree(
  session: Pick<Session, "path">,
  patch: { displayName?: string; comment?: string; workspaceStatus?: string },
): Promise<void> {
  const args = ["worktree", "set", "--worktree", worktreeSelector(session)];
  if (patch.displayName !== undefined) args.push("--display-name", patch.displayName);
  if (patch.comment !== undefined) args.push("--comment", patch.comment);
  if (patch.workspaceStatus !== undefined) args.push("--workspace-status", patch.workspaceStatus);
  await runOrca(args);
}

export async function openOrcaApp(): Promise<void> {
  await runOrca(["open"], { timeoutMs: 60_000 });
}

/** Bring the Orca window to the front (does not launch a second instance). */
export async function activateOrcaApp(): Promise<void> {
  await execFileAsync("/usr/bin/open", ["-b", ORCA_BUNDLE_ID]);
}

/**
 * Pick the terminal that hosts the session's primary agent, falling back to
 * the most recently active live terminal in that worktree.
 */
export function pickPrimaryTerminal(session: Session, terminals: Terminal[]): Terminal | undefined {
  const mine = terminals.filter((t) => t.worktreeId === session.worktreeId || t.worktreePath === session.path);
  if (mine.length === 0) return undefined;
  const agentKeys = new Set(session.agents.map((a) => a.paneKey));
  const agentTerm = mine.find((t) => agentKeys.has(agentPaneKey(t)));
  if (agentTerm) return agentTerm;
  return [...mine].sort((a, b) => (b.lastOutputAt ?? 0) - (a.lastOutputAt ?? 0))[0];
}

/** Focus a session in the Orca window: switch to its agent terminal, then raise the app. */
export async function focusSession(session: Session): Promise<Terminal | undefined> {
  const terminals = await listTerminals(session);
  const target = pickPrimaryTerminal(session, terminals);
  if (target) await switchTerminal(target.handle);
  await activateOrcaApp();
  return target;
}
