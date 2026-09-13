# Orca Sessions for Raycast

Control your [Orca](https://orca.stably.ai) agent sessions without leaving the keyboard.
The extension talks to the `orca` CLI that ships inside `Orca.app`, so it works with
every worktree, terminal and agent Orca already knows about.

## Commands

### Search Orca Sessions

Lists every Orca worktree, grouped by what its agents are doing:

| Section         | Meaning                                                        |
| --------------- | -------------------------------------------------------------- |
| Needs Attention | An agent is waiting for you (question, permission, blocked)    |
| Error           | An agent reported an error                                     |
| Working         | An agent is running                                            |
| Idle            | Nothing running: finished, plain terminal, or no terminal yet  |

The detail pane shows the current prompt, the last assistant message, the tool
being run and a preview of the terminal. The list refreshes itself every 5 s.

Actions (all reachable with `⌘K`):

| Action                        | Shortcut | What it does                                                    |
| ----------------------------- | -------- | --------------------------------------------------------------- |
| Focus in Orca                 | `⏎`      | Switches Orca to the session's agent terminal and raises the app |
| Send Prompt…                  | `⌘⏎`     | Types a message into the agent terminal (optionally presses ⏎)  |
| View Terminal Output          | `⌘O`     | Live view of the rendered terminal screen                        |
| Interrupt Agent               | `⌃C`     | Sends an interrupt to the agent                                  |
| New Terminal Here             | `⌘T`     | Starts Claude Code / Codex / OpenCode / a shell in the worktree  |
| New Session…                  | `⌘N`     | Opens the *New Orca Session* form for the same repo              |
| Set Workspace Status          | `⌘⇧S`    | Todo / In Progress / In Review / Completed                       |
| Edit Name / Comment…          | `⌘E`     | Rename the session or set its comment                            |
| Show in Finder / Open With    | `⌘⇧F` / `⌘⇧O` | Open the worktree folder                                   |
| Copy Path / Branch            | `⌘⇧C` / `⌘⇧B` |                                                             |
| Close All Terminals           | `⌘⇧W`    | Stops every terminal in the worktree (asks first)                |
| Remove Worktree               | `⌃X`     | `orca worktree rm` (asks first, offers `--force` on failure)     |

Use the dropdown in the search bar to filter by repository.

### New Orca Session

Creates a new worktree with `orca worktree create`. Pick the repository, name the
branch, choose an agent (Claude Code, Codex, OpenCode or none) and optionally hand
it an initial prompt. The new session is revealed in Orca when it is ready.

### Orca Sessions Menu Bar

A menu bar item that shows how many sessions need attention (or are working),
lists them by state, and jumps straight to any of them. Refreshes every 30 s.

## Requirements

- macOS with [Orca](https://orca.stably.ai) installed at `/Applications/Orca.app` and running.
- Raycast 1.80 or newer.

If Orca lives somewhere else, or you installed the `orca` shell command, point the
**Orca CLI Path** preference at it.

## Preferences

| Preference     | Default                                              | Purpose                                           |
| -------------- | ---------------------------------------------------- | ------------------------------------------------- |
| Orca CLI Path  | `/Applications/Orca.app/Contents/Resources/bin/orca` | Which `orca` binary to run                        |
| Default Agent  | Claude Code                                          | Agent preselected for new sessions and terminals  |
| Show archived  | off                                                  | Include archived worktrees in the list            |

## How it works

Everything goes through `orca … --json`:

- `orca worktree ps` — session list with agent states, prompts and previews
- `orca terminal list / switch / send / read / create / close`
- `orca worktree create / set / rm`, `orca repo list`, `orca status`, `orca open`

The Orca window is raised with `open -b com.stablyai.orca`, so no second instance is launched.

## Development

```bash
npm install
npm run dev      # loads the extension into Raycast in development mode
npm run lint     # eslint + prettier
npm run build
```
