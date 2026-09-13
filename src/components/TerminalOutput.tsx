import { Action, ActionPanel, Detail, Icon, Keyboard, Toast, showToast } from "@raycast/api";
import { showFailureToast, useCachedPromise } from "@raycast/utils";
import { useEffect, useState } from "react";
import { activateOrcaApp, readTerminal, sendToTerminal, switchTerminal } from "../lib/orca";
import { codeBlock } from "../lib/presentation";
import { SendPromptForm } from "./SendPromptForm";

const REFRESH_MS = 3000;

export function TerminalOutput(props: { terminalHandle: string; title: string }) {
  const [screenMode, setScreenMode] = useState(true);
  const { data, isLoading, error, revalidate } = useCachedPromise(
    (handle: string, screen: boolean) => readTerminal(handle, { screen, limit: 400 }),
    [props.terminalHandle, screenMode],
    { keepPreviousData: true },
  );

  useEffect(() => {
    const id = setInterval(() => revalidate(), REFRESH_MS);
    return () => clearInterval(id);
  }, [revalidate]);

  const lines = data?.tail ?? [];
  const markdown = error
    ? `**Could not read terminal**\n\n${error.message}`
    : `${codeBlock(lines)}\n\n_${screenMode ? "Rendered screen" : "Output stream"} · ${lines.length} lines · auto-refreshes every ${REFRESH_MS / 1000}s_`;

  async function interrupt() {
    try {
      await sendToTerminal(props.terminalHandle, { interrupt: true });
      await showToast({ style: Toast.Style.Success, title: "Interrupt sent" });
      revalidate();
    } catch (e) {
      await showFailureToast(e, { title: "Could not interrupt" });
    }
  }

  async function focus() {
    try {
      await switchTerminal(props.terminalHandle);
      await activateOrcaApp();
    } catch (e) {
      await showFailureToast(e, { title: "Could not focus terminal" });
    }
  }

  return (
    <Detail
      navigationTitle={props.title}
      isLoading={isLoading}
      markdown={markdown}
      actions={
        <ActionPanel>
          <ActionPanel.Section>
            <Action.Push
              title="Send Prompt…"
              icon={Icon.Message}
              target={<SendPromptForm terminalHandle={props.terminalHandle} title={props.title} onSent={revalidate} />}
            />
            <Action
              title="Focus in Orca"
              icon={Icon.Window}
              onAction={focus}
              shortcut={Keyboard.Shortcut.Common.Open}
            />
            <Action
              title="Interrupt Agent"
              icon={Icon.Stop}
              style={Action.Style.Destructive}
              onAction={interrupt}
              shortcut={{ modifiers: ["ctrl"], key: "c" }}
            />
          </ActionPanel.Section>
          <ActionPanel.Section>
            <Action
              title={screenMode ? "Show Output Stream" : "Show Rendered Screen"}
              icon={Icon.Switch}
              onAction={() => setScreenMode((v) => !v)}
              shortcut={{ modifiers: ["cmd"], key: "t" }}
            />
            <Action
              title="Refresh"
              icon={Icon.ArrowClockwise}
              onAction={revalidate}
              shortcut={Keyboard.Shortcut.Common.Refresh}
            />
            <Action.CopyToClipboard
              title="Copy Output"
              content={lines.join("\n")}
              shortcut={Keyboard.Shortcut.Common.Copy}
            />
            <Action.CopyToClipboard title="Copy Terminal Handle" content={props.terminalHandle} />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}
