import { Color, Icon, Image } from "@raycast/api";
import type { AgentState, PsAgent, Session } from "./orca";

export type StateBucket = "attention" | "working" | "idle" | "error";

export function bucketForState(state: AgentState | null | undefined): StateBucket {
  switch (state) {
    case "working":
    case "running":
      return "working";
    case "attention":
    case "blocked":
    case "waiting":
      return "attention";
    case "error":
    case "failed":
      return "error";
    default:
      return "idle";
  }
}

/** Overall bucket for a session: the most urgent among its agents, else the worktree status. */
export function sessionBucket(session: Session): StateBucket {
  const buckets = new Set<StateBucket>();
  for (const agent of session.agents) buckets.add(bucketForState(agent.state));
  if (buckets.size === 0) return bucketForState(session.status);
  if (buckets.has("attention")) return "attention";
  if (buckets.has("error")) return "error";
  if (buckets.has("working")) return "working";
  return "idle";
}

export function bucketTitle(bucket: StateBucket): string {
  switch (bucket) {
    case "attention":
      return "Needs Attention";
    case "working":
      return "Working";
    case "error":
      return "Error";
    default:
      return "Idle";
  }
}

export const BUCKET_ORDER: StateBucket[] = ["attention", "error", "working", "idle"];

export function stateColor(bucket: StateBucket): Color {
  switch (bucket) {
    case "attention":
      return Color.Orange;
    case "working":
      return Color.Blue;
    case "error":
      return Color.Red;
    default:
      return Color.SecondaryText;
  }
}

export function stateIcon(bucket: StateBucket): Image.ImageLike {
  switch (bucket) {
    case "attention":
      return { source: Icon.ExclamationMark, tintColor: Color.Orange };
    case "working":
      return { source: Icon.CircleProgress50, tintColor: Color.Blue };
    case "error":
      return { source: Icon.XMarkCircle, tintColor: Color.Red };
    default:
      return { source: Icon.Circle, tintColor: Color.SecondaryText };
  }
}

export function agentLabel(agentType: string | null | undefined): string {
  switch (agentType) {
    case "claude":
      return "Claude";
    case "codex":
      return "Codex";
    case "opencode":
      return "OpenCode";
    case "cursor":
      return "Cursor";
    case null:
    case undefined:
    case "":
      return "Shell";
    default:
      return agentType;
  }
}

export function stateLabel(state: AgentState | null | undefined): string {
  if (!state) return "no agent";
  return state.replace(/[_-]/g, " ");
}

export function shortBranch(branch: string | null | undefined): string {
  if (!branch) return "";
  return branch.replace(/^refs\/heads\//, "");
}

export function relativeTime(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return "";
  const diff = Math.max(0, now - ts);
  const s = Math.round(diff / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function primaryAgent(session: Session): PsAgent | undefined {
  if (session.agents.length === 0) return undefined;
  // Most urgent first, then most recently updated.
  const rank: Record<StateBucket, number> = { attention: 0, error: 1, working: 2, idle: 3 };
  return [...session.agents].sort((a, b) => {
    const r = rank[bucketForState(a.state)] - rank[bucketForState(b.state)];
    return r !== 0 ? r : b.updatedAt - a.updatedAt;
  })[0];
}

export function oneLine(text: string | null | undefined, max = 90): string {
  if (!text) return "";
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const ESC = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g");

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

export function codeBlock(lines: string[] | string | null | undefined): string {
  const raw = Array.isArray(lines) ? lines.join("\n") : (lines ?? "");
  const cleaned = stripAnsi(raw).replace(/```/g, "'''");
  return "```text\n" + (cleaned.trim() ? cleaned : "(no output)") + "\n```";
}

export const WORKSPACE_STATUSES = [
  { id: "todo", title: "Todo" },
  { id: "in-progress", title: "In Progress" },
  { id: "in-review", title: "In Review" },
  { id: "completed", title: "Completed" },
];

export function sessionMarkdown(session: Session): string {
  const agent = primaryAgent(session);
  const parts: string[] = [];
  parts.push(`## ${session.displayName}`);
  if (agent) {
    if (agent.taskTitle) parts.push(`**Task:** ${agent.taskTitle}`);
    if (agent.prompt) parts.push(`**Prompt:** ${oneLine(agent.prompt, 400)}`);
    if (agent.lastAssistantMessage) parts.push(`**Last message:**\n\n${agent.lastAssistantMessage.trim()}`);
    if (agent.toolName) {
      parts.push(
        `**Running tool:** \`${agent.toolName}\`` + (agent.toolInput ? `\n\n${codeBlock(agent.toolInput)}` : ""),
      );
    }
  }
  if (session.comment) parts.push(`**Comment:** ${session.comment}`);
  parts.push(`**Terminal preview**\n\n${codeBlock(session.preview)}`);
  return parts.join("\n\n");
}
