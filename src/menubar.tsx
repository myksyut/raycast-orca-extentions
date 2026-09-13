import { Color, Icon, LaunchType, MenuBarExtra, launchCommand, open, Keyboard } from "@raycast/api";
import { showFailureToast, useCachedPromise } from "@raycast/utils";
import { Session, activateOrcaApp, focusSession, getPrefs, listSessions } from "./lib/orca";
import {
  BUCKET_ORDER,
  StateBucket,
  agentLabel,
  bucketTitle,
  oneLine,
  primaryAgent,
  sessionBucket,
  stateIcon,
} from "./lib/presentation";

const MAX_PER_SECTION = 12;

export default function Command() {
  const { showArchived } = getPrefs();
  const { data, isLoading, error, revalidate } = useCachedPromise(listSessions, [], { keepPreviousData: true });

  const sessions = (data ?? []).filter((s) => showArchived || !s.isArchived);
  const grouped = new Map<StateBucket, Session[]>();
  for (const s of sessions) {
    const b = sessionBucket(s);
    grouped.set(b, [...(grouped.get(b) ?? []), s]);
  }
  for (const list of grouped.values()) list.sort((a, b) => b.lastActivityAt - a.lastActivityAt);

  const attention = grouped.get("attention")?.length ?? 0;
  const errors = grouped.get("error")?.length ?? 0;
  const working = grouped.get("working")?.length ?? 0;

  const icon = error
    ? { source: Icon.ExclamationMark, tintColor: Color.SecondaryText }
    : attention > 0
      ? stateIcon("attention")
      : errors > 0
        ? stateIcon("error")
        : working > 0
          ? stateIcon("working")
          : { source: "icon.png" };
  const title = attention > 0 ? String(attention) : working > 0 ? String(working) : undefined;

  async function focus(session: Session) {
    try {
      await focusSession(session);
    } catch (e) {
      await showFailureToast(e, { title: "Could not focus session" });
    }
  }

  return (
    <MenuBarExtra icon={icon} title={title} isLoading={isLoading} tooltip="Orca sessions">
      {error ? (
        <MenuBarExtra.Section title="Orca">
          <MenuBarExtra.Item title={oneLine(error.message, 60)} icon={Icon.Warning} />
          <MenuBarExtra.Item title="Open Orca" icon={Icon.AppWindow} onAction={() => open("", "com.stablyai.orca")} />
        </MenuBarExtra.Section>
      ) : null}
      {BUCKET_ORDER.map((bucket) => {
        const list = grouped.get(bucket);
        if (!list || list.length === 0) return null;
        return (
          <MenuBarExtra.Section key={bucket} title={`${bucketTitle(bucket)} (${list.length})`}>
            {list.slice(0, MAX_PER_SECTION).map((s) => {
              const agent = primaryAgent(s);
              const subtitle = agent
                ? `${agentLabel(agent.agentType)} · ${oneLine(agent.taskTitle ?? agent.prompt, 40)}`
                : s.repo;
              return (
                <MenuBarExtra.Item
                  key={s.worktreeId}
                  title={s.displayName}
                  subtitle={subtitle}
                  icon={stateIcon(bucket)}
                  tooltip={`${s.repo} · ${s.path}`}
                  onAction={() => focus(s)}
                />
              );
            })}
          </MenuBarExtra.Section>
        );
      })}
      {!error && sessions.length === 0 ? <MenuBarExtra.Item title="No Orca sessions" /> : null}
      <MenuBarExtra.Section>
        <MenuBarExtra.Item
          title="Search Sessions…"
          icon={Icon.MagnifyingGlass}
          shortcut={{ modifiers: ["cmd"], key: "f" }}
          onAction={() => launchCommand({ name: "sessions", type: LaunchType.UserInitiated })}
        />
        <MenuBarExtra.Item
          title="New Session…"
          icon={Icon.Plus}
          shortcut={Keyboard.Shortcut.Common.New}
          onAction={() => launchCommand({ name: "new-session", type: LaunchType.UserInitiated })}
        />
        <MenuBarExtra.Item title="Open Orca" icon={Icon.AppWindow} onAction={() => activateOrcaApp()} />
        <MenuBarExtra.Item
          title="Refresh"
          icon={Icon.ArrowClockwise}
          shortcut={Keyboard.Shortcut.Common.Refresh}
          onAction={() => revalidate()}
        />
      </MenuBarExtra.Section>
    </MenuBarExtra>
  );
}
