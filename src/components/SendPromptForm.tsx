import { Action, ActionPanel, Form, Icon, Toast, showToast, useNavigation } from "@raycast/api";
import { showFailureToast, useForm } from "@raycast/utils";
import { activateOrcaApp, sendToTerminal, switchTerminal } from "../lib/orca";

interface Values {
  prompt: string;
  enter: boolean;
  focus: boolean;
}

export function SendPromptForm(props: { terminalHandle: string; title: string; onSent?: () => void }) {
  const { pop } = useNavigation();
  const { handleSubmit, itemProps } = useForm<Values>({
    initialValues: { prompt: "", enter: true, focus: false },
    validation: { prompt: (v) => (!v || !v.trim() ? "Type something to send" : undefined) },
    async onSubmit(values) {
      const toast = await showToast({ style: Toast.Style.Animated, title: "Sending to Orca…" });
      try {
        await sendToTerminal(props.terminalHandle, { text: values.prompt, enter: values.enter });
        if (values.focus) {
          await switchTerminal(props.terminalHandle);
          await activateOrcaApp();
        }
        toast.style = Toast.Style.Success;
        toast.title = values.enter ? "Prompt sent" : "Text typed (not submitted)";
        props.onSent?.();
        pop();
      } catch (e) {
        toast.hide();
        await showFailureToast(e, { title: "Could not send to terminal" });
      }
    },
  });

  return (
    <Form
      navigationTitle={`Send to ${props.title}`}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Send" icon={Icon.ArrowRight} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description title="Terminal" text={props.title} />
      <Form.TextArea
        title="Prompt"
        placeholder="Message for the agent (or a shell command)"
        enableMarkdown={false}
        autoFocus
        {...itemProps.prompt}
      />
      <Form.Checkbox label="Press Enter after typing" {...itemProps.enter} />
      <Form.Checkbox label="Switch to this terminal in Orca after sending" {...itemProps.focus} />
    </Form>
  );
}
