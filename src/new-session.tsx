import { Action, ActionPanel, Form, Icon, Toast, popToRoot, showToast, useNavigation } from "@raycast/api";
import { showFailureToast, useCachedPromise, useForm } from "@raycast/utils";
import { activateOrcaApp, createWorktree, getPrefs, listRepos } from "./lib/orca";

interface Values {
  repoId: string;
  name: string;
  agent: string;
  prompt: string;
  baseBranch: string;
  comment: string;
  activate: boolean;
}

const AGENTS = [
  { value: "claude", title: "Claude Code" },
  { value: "codex", title: "Codex" },
  { value: "opencode", title: "OpenCode" },
  { value: "", title: "No agent (plain terminal)" },
];

export function NewSessionForm(props: { defaultRepoId?: string; onCreated?: () => void }) {
  const { defaultAgent } = getPrefs();
  const { pop } = useNavigation();
  const { data: repos, isLoading, error } = useCachedPromise(listRepos, [], { keepPreviousData: true });

  const { handleSubmit, itemProps, values } = useForm<Values>({
    initialValues: {
      repoId: props.defaultRepoId ?? "",
      name: "",
      agent: defaultAgent,
      prompt: "",
      baseBranch: "",
      comment: "",
      activate: true,
    },
    validation: {
      repoId: (v) => (!v ? "Pick a repository" : undefined),
      name: (v) => {
        if (!v || !v.trim()) return "Name is required";
        if (/\s/.test(v.trim())) return "No spaces (it becomes the branch name)";
        return undefined;
      },
    },
    async onSubmit(v) {
      const toast = await showToast({ style: Toast.Style.Animated, title: "Creating worktree…", message: v.name });
      try {
        await createWorktree({
          name: v.name.trim(),
          repoId: v.repoId,
          agent: v.agent || undefined,
          prompt: v.agent ? v.prompt : undefined,
          baseBranch: v.baseBranch,
          comment: v.comment,
          activate: v.activate,
        });
        toast.style = Toast.Style.Success;
        toast.title = "Session created";
        toast.message = v.agent ? `${v.name} · ${v.agent} started` : v.name;
        if (v.activate) await activateOrcaApp();
        if (props.onCreated) {
          props.onCreated();
          pop();
        } else {
          await popToRoot();
        }
      } catch (e) {
        toast.hide();
        await showFailureToast(e, { title: "Could not create session" });
      }
    },
  });

  const agentSelected = values.agent !== "";

  return (
    <Form
      navigationTitle="New Orca Session"
      isLoading={isLoading}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Create Session" icon={Icon.Plus} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      {error ? <Form.Description title="Orca" text={`Could not load repositories: ${error.message}`} /> : null}
      <Form.Dropdown title="Repository" {...itemProps.repoId}>
        {(repos ?? []).map((r) => (
          <Form.Dropdown.Item
            key={r.id}
            value={r.id}
            title={r.displayName}
            icon={{ source: Icon.Folder, tintColor: r.badgeColor }}
          />
        ))}
      </Form.Dropdown>
      <Form.TextField
        title="Name"
        placeholder="fix-login-bug (used as branch / folder name)"
        autoFocus
        {...itemProps.name}
      />
      <Form.Dropdown title="Agent" {...itemProps.agent}>
        {AGENTS.map((a) => (
          <Form.Dropdown.Item key={a.value || "none"} value={a.value} title={a.title} />
        ))}
      </Form.Dropdown>
      {agentSelected ? (
        <Form.TextArea
          title="Initial Prompt"
          placeholder="What should the agent do first? (optional)"
          {...itemProps.prompt}
        />
      ) : null}
      <Form.Separator />
      <Form.TextField title="Base Branch" placeholder="Leave empty for the repo default" {...itemProps.baseBranch} />
      <Form.TextField title="Comment" placeholder="Shown on the session card (optional)" {...itemProps.comment} />
      <Form.Checkbox label="Reveal the new session in Orca" {...itemProps.activate} />
    </Form>
  );
}

export default function Command() {
  return <NewSessionForm />;
}
