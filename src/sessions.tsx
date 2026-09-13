import {
  Action,
  ActionPanel,
  Alert,
  Color,
  Form,
  Icon,
  Keyboard,
  List,
  Toast,
  confirmAlert,
  showToast,
  useNavigation,
} from "@raycast/api";
import { showFailureToast, useCachedPromise, useCachedState, useForm } from "@raycast/utils";
import { useEffect, useMemo, useState } from "react";
import { SendPromptForm } from "./components/SendPromptForm";
import { TerminalOutput } from "./components/TerminalOutput";
import {
  Session,
  Terminal,
  activateOrcaApp,
  closeAllTerminals,
  createTerminal,
  focusSession,
  getPrefs,
  listSessions,
  listTerminals,
  openOrcaApp,
  pickPrimaryTerminal,
  removeWorktree,
  sendToTerminal,
  setWorktree,
} from "./lib/orca";
import {
  BUCKET_ORDER,
  StateBucket,
  WORKSPACE_STATUSES,
  agentLabel,
  bucketTitle,
  oneLine,
  primaryAgent,
  relativeTime,
  sessionBucket,
  sessionMarkdown,
  shortBranch,
  stateColor,
  stateIcon,
  stateLabel,
} from "./lib/presentation";
import { NewSessionForm } from "./new-session";

const REFRESH_MS = 5000;

export default function Command() {
  const { showArchived, defaultAgent } = getPrefs();
  const { push } = useNavigation();
  const { data, isLoading, error, revalidate } = useCachedPromise(listSessions, [], { keepPreviousData: true });
  const [repoFilter, setRepoFilter] = useCachedState<string>("repo-filter", "all");
  const [showDetail, setShowDetail] = useCachedState<boolean>("show-detail", true);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      revalidate();
      setNow(Date.now());
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [revalidate]);

  const repos = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of data ?? []) map.set(s.repoId, s.repo);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  const grouped = useMemo(() => {
    const out = new Map<StateBucket, Session[]>();
    for (const s of data ?? []) {
      if (!showArchived && s.isArchived) continue;
      if (repoFilter !== "all" && s.repoId !== repoFilter) continue;
      const b = sessionBucket(s);
      out.set(b, [...(out.get(b) ?? []), s]);
    }
    for (const list of out.values()) {
      list.sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || b.lastActivityAt - a.lastActivityAt);
    }
    return out;
  }, [data, repoFilter, showArchived]);

  const total = [...grouped.values()].reduce((n, l) => n + l.length, 0);

  return (
    <List
      isLoading={isLoading}
      isShowingDetail={showDetail && total > 0}
      searchBarPlaceholder="Search sessions by name, branch, repo, prompt…"
      searchBarAccessory={
        <List.Dropdown tooltip="Repository" value={repoFilter} onChange={setRepoFilter} storeValue>
          <List.Dropdown.Item title="All Repositories" value="all" icon={Icon.Folder} />
          <List.Dropdown.Section title="Repositories">
            {repos.map(([id, name]) => (
              <List.Dropdown.Item key={id} title={name} value={id} icon={Icon.Folder} />
            ))}
          </List.Dropdown.Section>
        </List.Dropdown>
      }
    >
      {error ? (
        <List.EmptyView
          icon={{ source: Icon.Plug, tintColor: Color.Red }}
          title="Orca is not reachable"
          description={error.message}
          actions={
            <ActionPanel>
              <Action title="Open Orca" icon={Icon.AppWindow} onAction={() => launchOrca(revalidate)} />
              <Action
                title="Retry"
                icon={Icon.ArrowClockwise}
                onAction={revalidate}
                shortcut={Keyboard.Shortcut.Common.Refresh}
              />
            </ActionPanel>
          }
        />
      ) : total === 0 && !isLoading ? (
        <List.EmptyView
          icon={Icon.Tray}
          title="No Orca sessions"
          description="Create a worktree to start an agent session."
          actions={
            <ActionPanel>
              <Action.Push title="New Session…" icon={Icon.Plus} target={<NewSessionForm onCreated={revalidate} />} />
              <Action title="Open Orca" icon={Icon.AppWindow} onAction={() => activateOrcaApp()} />
            </ActionPanel>
          }
        />
      ) : (
        BUCKET_ORDER.map((bucket) => {
          const list = grouped.get(bucket);
          if (!list || list.length === 0) return null;
          return (
            <List.Section key={bucket} title={bucketTitle(bucket)} subtitle={String(list.length)}>
              {list.map((s) => (
                <SessionItem
                  key={s.worktreeId}
                  session={s}
                  bucket={bucket}
                  now={now}
                  showDetail={showDetail}
                  defaultAgent={defaultAgent}
                  onToggleDetail={() => setShowDetail((v) => !v)}
                  onChanged={revalidate}
                  push={push}
                />
              ))}
            </List.Section>
          );
        })
      )}
    </List>
  );
}

async function launchOrca(onDone: () => void) {
  const toast = await showToast({ style: Toast.Style.Animated, title: "Launching Orca…" });
  try {
    await openOrcaApp();
    toast.style = Toast.Style.Success;
    toast.title = "Orca is running";
    onDone();
  } catch (e) {
    toast.hide();
    await showFailureToast(e, { title: "Could not launch Orca" });
  }
}

interface ItemProps {
  session: Session;
  bucket: StateBucket;
  now: number;
  showDetail: boolean;
  defaultAgent: string;
  onToggleDetail: () => void;
  onChanged: () => void;
  push: ReturnType<typeof useNavigation>["push"];
}

function SessionItem({
  session: s,
  bucket,
  now,
  showDetail,
  defaultAgent,
  onToggleDetail,
  onChanged,
  push,
}: ItemProps) {
  const agent = primaryAgent(s);
  const branch = shortBranch(s.branch);
  const keywords = [
    s.repo,
    branch,
    s.path,
    s.comment,
    agent?.prompt ?? "",
    agent?.taskTitle ?? "",
    agent?.agentType ?? "",
  ].filter(Boolean);

  const accessories: List.Item.Accessory[] = [];
  if (s.unread) accessories.push({ icon: { source: Icon.Dot, tintColor: Color.Blue }, tooltip: "Unread" });
  if (s.isPinned) accessories.push({ icon: Icon.Pin, tooltip: "Pinned" });
  if (!showDetail) {
    if (agent)
      accessories.push({
        tag: { value: `${agentLabel(agent.agentType)} · ${stateLabel(agent.state)}`, color: stateColor(bucket) },
      });
    else if (s.liveTerminalCount > 0)
      accessories.push({
        tag: {
          value: `${s.liveTerminalCount} terminal${s.liveTerminalCount > 1 ? "s" : ""}`,
          color: Color.SecondaryText,
        },
      });
    if (branch) accessories.push({ icon: Icon.Code, text: branch, tooltip: "Branch" });
    accessories.push({
      text: relativeTime(s.lastActivityAt, now),
      tooltip: new Date(s.lastActivityAt).toLocaleString(),
    });
  } else if (agent) {
    accessories.push({ tag: { value: stateLabel(agent.state), color: stateColor(bucket) } });
  }

  const subtitle = showDetail ? undefined : oneLine(agent?.taskTitle ?? agent?.prompt ?? s.comment, 70) || s.repo;

  async function resolveTerminal(): Promise<Terminal | undefined> {
    const terminals = await listTerminals(s);
    const t = pickPrimaryTerminal(s, terminals);
    if (!t)
      await showToast({
        style: Toast.Style.Failure,
        title: "No live terminal in this session",
        message: "Open a new terminal first.",
      });
    return t;
  }

  async function withTerminal(action: (t: Terminal) => Promise<void> | void, failTitle: string) {
    try {
      const t = await resolveTerminal();
      if (t) await action(t);
    } catch (e) {
      await showFailureToast(e, { title: failTitle });
    }
  }

  async function focus() {
    try {
      const t = await focusSession(s);
      if (!t)
        await showToast({
          style: Toast.Style.Success,
          title: "Orca opened",
          message: "This session has no live terminal to switch to.",
        });
    } catch (e) {
      await showFailureToast(e, { title: "Could not focus session" });
    }
  }

  async function newTerminal(command: string | undefined, label: string) {
    const toast = await showToast({ style: Toast.Style.Animated, title: `Starting ${label}…`, message: s.displayName });
    try {
      await createTerminal({ session: s, command, focus: true });
      await activateOrcaApp();
      toast.style = Toast.Style.Success;
      toast.title = `${label} started`;
      onChanged();
    } catch (e) {
      toast.hide();
      await showFailureToast(e, { title: `Could not start ${label}` });
    }
  }

  async function setStatus(id: string, title: string) {
    try {
      await setWorktree(s, { workspaceStatus: id });
      await showToast({ style: Toast.Style.Success, title: `Status: ${title}`, message: s.displayName });
      onChanged();
    } catch (e) {
      await showFailureToast(e, { title: "Could not update status" });
    }
  }

  async function closeAll() {
    const ok = await confirmAlert({
      title: `Close all terminals in “${s.displayName}”?`,
      message:
        "Every terminal process in this worktree is stopped and its tabs are removed. The worktree itself stays.",
      icon: Icon.XMarkCircle,
      primaryAction: { title: "Close Terminals", style: Alert.ActionStyle.Destructive },
    });
    if (!ok) return;
    try {
      await closeAllTerminals(s);
      await showToast({ style: Toast.Style.Success, title: "Terminals closed", message: s.displayName });
      onChanged();
    } catch (e) {
      await showFailureToast(e, { title: "Could not close terminals" });
    }
  }

  async function remove() {
    const ok = await confirmAlert({
      title: `Remove worktree “${s.displayName}”?`,
      message: `Removes ${s.path} from Orca and git, and deletes the local branch when it is safe to do so. This cannot be undone.`,
      icon: Icon.Trash,
      primaryAction: { title: "Remove Worktree", style: Alert.ActionStyle.Destructive },
    });
    if (!ok) return;
    const toast = await showToast({ style: Toast.Style.Animated, title: "Removing worktree…", message: s.displayName });
    try {
      await removeWorktree(s);
      toast.style = Toast.Style.Success;
      toast.title = "Worktree removed";
      onChanged();
    } catch (e) {
      toast.hide();
      const msg = e instanceof Error ? e.message : String(e);
      const force = await confirmAlert({
        title: "Removal failed",
        message: `${msg}\n\nRetry with --force? Uncommitted changes in the worktree will be lost.`,
        icon: Icon.Warning,
        primaryAction: { title: "Force Remove", style: Alert.ActionStyle.Destructive },
      });
      if (!force) return;
      try {
        await removeWorktree(s, true);
        await showToast({ style: Toast.Style.Success, title: "Worktree removed", message: s.displayName });
        onChanged();
      } catch (e2) {
        await showFailureToast(e2, { title: "Could not remove worktree" });
      }
    }
  }

  return (
    <List.Item
      id={s.worktreeId}
      icon={stateIcon(bucket)}
      title={s.displayName}
      subtitle={subtitle}
      keywords={keywords}
      accessories={accessories}
      detail={showDetail ? <SessionDetail session={s} bucket={bucket} now={now} /> : undefined}
      actions={
        <ActionPanel title={s.displayName}>
          <ActionPanel.Section>
            <Action title="Focus in Orca" icon={Icon.Window} onAction={focus} />
            <Action
              title="Send Prompt…"
              icon={Icon.Message}
              shortcut={{ modifiers: ["cmd"], key: "return" }}
              onAction={() =>
                withTerminal(
                  (t) =>
                    push(
                      <SendPromptForm
                        terminalHandle={t.handle}
                        title={`${s.displayName} · ${t.title}`}
                        onSent={onChanged}
                      />,
                    ),
                  "Could not open prompt form",
                )
              }
            />
            <Action
              title="View Terminal Output"
              icon={Icon.Terminal}
              shortcut={Keyboard.Shortcut.Common.Open}
              onAction={() =>
                withTerminal(
                  (t) => push(<TerminalOutput terminalHandle={t.handle} title={`${s.displayName} · ${t.title}`} />),
                  "Could not read terminal",
                )
              }
            />
            <Action
              title="Interrupt Agent"
              icon={Icon.Stop}
              style={Action.Style.Destructive}
              shortcut={{ modifiers: ["ctrl"], key: "c" }}
              onAction={() =>
                withTerminal(async (t) => {
                  await sendToTerminal(t.handle, { interrupt: true });
                  await showToast({ style: Toast.Style.Success, title: "Interrupt sent", message: t.title });
                }, "Could not interrupt")
              }
            />
          </ActionPanel.Section>

          <ActionPanel.Section>
            <ActionPanel.Submenu title="New Terminal Here" icon={Icon.Plus} shortcut={{ modifiers: ["cmd"], key: "t" }}>
              <Action
                title={`Start ${agentLabel(defaultAgent)} (Default)`}
                icon={Icon.Bolt}
                onAction={() => newTerminal(defaultAgent, agentLabel(defaultAgent))}
              />
              <Action title="Start Claude Code" icon={Icon.Stars} onAction={() => newTerminal("claude", "Claude")} />
              <Action title="Start Codex" icon={Icon.Stars} onAction={() => newTerminal("codex", "Codex")} />
              <Action title="Start OpenCode" icon={Icon.Stars} onAction={() => newTerminal("opencode", "OpenCode")} />
              <Action title="Plain Shell" icon={Icon.Terminal} onAction={() => newTerminal(undefined, "terminal")} />
            </ActionPanel.Submenu>
            <Action.Push
              title="New Session…"
              icon={Icon.PlusSquare}
              shortcut={Keyboard.Shortcut.Common.New}
              target={<NewSessionForm defaultRepoId={s.repoId} onCreated={onChanged} />}
            />
            <ActionPanel.Submenu
              title="Set Workspace Status"
              icon={Icon.Tag}
              shortcut={Keyboard.Shortcut.Common.Duplicate}
            >
              {WORKSPACE_STATUSES.map((st) => (
                <Action
                  key={st.id}
                  title={st.title}
                  icon={s.workspaceStatus === st.id ? Icon.CheckCircle : Icon.Circle}
                  onAction={() => setStatus(st.id, st.title)}
                />
              ))}
            </ActionPanel.Submenu>
            <Action.Push
              title="Edit Name / Comment…"
              icon={Icon.Pencil}
              shortcut={Keyboard.Shortcut.Common.Edit}
              target={<EditSessionForm session={s} onSaved={onChanged} />}
            />
          </ActionPanel.Section>

          <ActionPanel.Section>
            <Action.ShowInFinder path={s.path} shortcut={{ modifiers: ["cmd", "shift"], key: "f" }} />
            <Action.OpenWith path={s.path} shortcut={Keyboard.Shortcut.Common.OpenWith} />
            <Action.CopyToClipboard title="Copy Path" content={s.path} shortcut={Keyboard.Shortcut.Common.Copy} />
            {branch ? (
              <Action.CopyToClipboard
                title="Copy Branch"
                content={branch}
                shortcut={{ modifiers: ["cmd", "shift"], key: "b" }}
              />
            ) : null}
            <Action.CopyToClipboard title="Copy Worktree Selector" content={`path:${s.path}`} />
          </ActionPanel.Section>

          <ActionPanel.Section>
            <Action
              title={showDetail ? "Hide Details" : "Show Details"}
              icon={Icon.Sidebar}
              shortcut={{ modifiers: ["cmd"], key: "d" }}
              onAction={onToggleDetail}
            />
            <Action
              title="Refresh"
              icon={Icon.ArrowClockwise}
              shortcut={Keyboard.Shortcut.Common.Refresh}
              onAction={onChanged}
            />
            <Action title="Open Orca" icon={Icon.AppWindow} onAction={() => activateOrcaApp()} />
          </ActionPanel.Section>

          <ActionPanel.Section>
            <Action
              title="Close All Terminals"
              icon={Icon.XMarkCircle}
              style={Action.Style.Destructive}
              shortcut={{ modifiers: ["cmd", "shift"], key: "w" }}
              onAction={closeAll}
            />
            <Action
              title="Remove Worktree"
              icon={Icon.Trash}
              style={Action.Style.Destructive}
              shortcut={{ modifiers: ["ctrl"], key: "x" }}
              onAction={remove}
            />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

function SessionDetail({ session: s, bucket, now }: { session: Session; bucket: StateBucket; now: number }) {
  const branch = shortBranch(s.branch);
  return (
    <List.Item.Detail
      markdown={sessionMarkdown(s)}
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.TagList title="State">
            <List.Item.Detail.Metadata.TagList.Item text={bucketTitle(bucket)} color={stateColor(bucket)} />
            {s.isActive ? <List.Item.Detail.Metadata.TagList.Item text="Active in Orca" color={Color.Green} /> : null}
            {s.isArchived ? (
              <List.Item.Detail.Metadata.TagList.Item text="Archived" color={Color.SecondaryText} />
            ) : null}
          </List.Item.Detail.Metadata.TagList>
          {s.agents.length > 0 ? (
            <List.Item.Detail.Metadata.TagList title={s.agents.length > 1 ? "Agents" : "Agent"}>
              {s.agents.map((a) => (
                <List.Item.Detail.Metadata.TagList.Item
                  key={a.paneKey}
                  text={`${agentLabel(a.agentType)} · ${stateLabel(a.state)}${a.interrupted ? " (interrupted)" : ""}`}
                  color={stateColor(sessionBucketFor(a.state))}
                />
              ))}
            </List.Item.Detail.Metadata.TagList>
          ) : null}
          <List.Item.Detail.Metadata.Label
            title="Workspace Status"
            text={WORKSPACE_STATUSES.find((w) => w.id === s.workspaceStatus)?.title ?? s.workspaceStatus}
          />
          <List.Item.Detail.Metadata.Label title="Terminals" text={String(s.liveTerminalCount)} />
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label title="Repository" text={s.repo} />
          {branch ? <List.Item.Detail.Metadata.Label title="Branch" text={branch} /> : null}
          <List.Item.Detail.Metadata.Label title="Path" text={s.path} />
          {s.hostId !== "local" ? <List.Item.Detail.Metadata.Label title="Host" text={s.hostId} /> : null}
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label title="Last Activity" text={relativeTime(s.lastActivityAt, now)} />
          {s.lastOutputAt ? (
            <List.Item.Detail.Metadata.Label title="Last Output" text={relativeTime(s.lastOutputAt, now)} />
          ) : null}
          <List.Item.Detail.Metadata.Label title="Created" text={new Date(s.createdAt).toLocaleString()} />
          {s.linkedIssue ? <List.Item.Detail.Metadata.Label title="Issue" text={`#${s.linkedIssue}`} /> : null}
          {s.linkedPR ? <List.Item.Detail.Metadata.Label title="Pull Request" text={`#${s.linkedPR}`} /> : null}
          {s.linkedLinearIssue ? <List.Item.Detail.Metadata.Label title="Linear" text={s.linkedLinearIssue} /> : null}
        </List.Item.Detail.Metadata>
      }
    />
  );
}

function sessionBucketFor(state: string): StateBucket {
  return sessionBucket({ agents: [{ state }], status: null } as unknown as Session);
}

function EditSessionForm({ session: s, onSaved }: { session: Session; onSaved: () => void }) {
  const { pop } = useNavigation();
  const { handleSubmit, itemProps } = useForm<{ displayName: string; comment: string }>({
    initialValues: { displayName: s.displayName, comment: s.comment ?? "" },
    async onSubmit(v) {
      try {
        const patch: { displayName?: string; comment?: string } = {};
        if (v.displayName.trim() !== s.displayName) patch.displayName = v.displayName.trim();
        if (v.comment !== (s.comment ?? "")) patch.comment = v.comment;
        if (Object.keys(patch).length > 0) await setWorktree(s, patch);
        await showToast({ style: Toast.Style.Success, title: "Session updated" });
        onSaved();
        pop();
      } catch (e) {
        await showFailureToast(e, { title: "Could not update session" });
      }
    },
  });
  return (
    <Form
      navigationTitle={`Edit ${s.displayName}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save" icon={Icon.Check} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.TextField title="Display Name" {...itemProps.displayName} />
      <Form.TextField title="Comment" placeholder="e.g. waiting on review" {...itemProps.comment} />
      <Form.Description title="Path" text={s.path} />
    </Form>
  );
}
