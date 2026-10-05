# agent-workflow-tooling

The shared agent tooling for Reference Systems Lab. It is a plugin marketplace that **Claude Code,
Codex and GitHub Copilot CLI all install from directly**, plus a small `rsl` CLI that sets up a
machine or a repository in one command. Every contributor gets the same skills, whichever agent
they use.

Skills are written once, in the [Agent Skills](https://agentskills.io) format, and every tool gets
the same copy.

## Only inside the organization

Nothing here is enabled for a whole machine. Each repository, and the `commerce/` folder that
holds them, declares its plugins in committed project settings, so contributors can
work on other codebases on the same machine without the lab's skills following them there:

- **Claude Code** installs the plugins at project scope when the folder is opened, and they stay
  off everywhere else.
- **Codex** has no project install, so `rsl init` installs the plugins for the user, switches them
  off in `~/.codex/config.toml`, and switches them on in the project's `.codex/config.toml`.
- **Copilot CLI** reads `.github/copilot/settings.json` in the repository. It only installs plugins
  from this marketplace, so Copilot users do not get `context7` or `playwright`.

## Plugins

| Plugin     | Skills                                                                             | Also                                                                                |
| ---------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `workflow` | `feature-brief`, `-research`, `-plan`, `-execute`, `-review`; `bugfix`, `feedback` | `worklog` CLI (time, issue records, forecasts); project issue forms and PR template |
| `org`      | `org-setup`                                                                        | `SECURITY.md` scaffold                                                              |
| `frontend` | `frontend-craft`                                                                   |                                                                                     |

`workflow` keeps each piece of work on its GitHub issue, from brief to review. `org-setup` gives a
repository the labels, ruleset, CODEOWNERS and team Project that workflow expects. One Project
plans the work of every repository, sprints included. It is also the board of the parent
repository, `commerce`, where work that spans repositories is planned and split into sub-issues.

## Profiles

[`profiles.json`](profiles.json) has one profile per repository. Each adds to `base`, which every
repository and the parent folder use:

| Profile                                            | Plugins                               |
| -------------------------------------------------- | ------------------------------------- |
| `base`                                             | workflow, org, context7               |
| `storefront`, `admin`, `checkout`, `design-system` | base + frontend, playwright           |
| `backend`, `platform`, `agent-workflow-tooling`    | base (their own skills arrive later)  |

A repository's own skills and agents go in a plugin of their own, added to that repository's
profile. `rsl list` prints the current set.

## Set up a machine

```bash
git clone git@github.com:Reference-Systems-Lab/agent-workflow-tooling.git
cd agent-workflow-tooling
npm ci
node cli/rsl.mjs install --dry-run   # preview; anything replaced is backed up first
node cli/rsl.mjs install
```

`install` is safe to re-run. It adds this checkout as the `agent-workflow-tooling` marketplace in
Claude Code, Codex and Copilot CLI (each one that is installed), and links `~/.local/bin/rsl` and
`~/.local/bin/worklog`. It enables no plugin and leaves global instructions alone.

`rsl doctor` checks for broken links and for skills a tool would load twice.

## Set up a repository

```bash
cd commerce && rsl init base                # the parent folder
cd storefront && rsl init storefront        # each repository, with its own profile
```

This writes, and you commit:

- `.claude/settings.json`: enables the plugins and declares their marketplaces, so Claude Code
  offers to install them for anyone who opens the repository;
- `.github/copilot/settings.json`: the same for Copilot CLI, listing only this marketplace's
  plugins;
- `.codex/config.toml`: switches the plugins on for this repository once Codex trusts it;
- `AGENTS.md` if it is missing, and a `CLAUDE.md` containing `@AGENTS.md`, so all tools share one
  set of instructions. A repository that already has its own `CLAUDE.md` is left alone;
- the files each plugin offers from its `scaffold/` folder, only those the repository lacks:
  workflow's issue forms, PR template and `.agent/` in `.gitignore` (merged, never replaced), and
  org's `SECURITY.md`.

`init` works out every change first and writes nothing if any file cannot be edited safely.
`--no-codex` skips the Codex install.

## Add or change a skill

1. Create `plugins/<plugin>/skills/<name>/SKILL.md` with `name` (matching the folder) and a
   `description` that says when to use it. Skills every repository needs go in `workflow` or `org`;
   a repository's own skills go in its plugin. Write "the agent", not "Claude" or "Codex". An
   optional `agents/openai.yaml` sets how Codex displays it.
2. `npm run validate`, then commit.
3. `rsl update`. Claude Code keeps a copy per commit, so it picks up committed changes; Codex
   re-copies the working tree, keeping plugins switched off where they were; Copilot CLI loads this
   marketplace live.

A new plugin is a folder with `.claude-plugin/plugin.json` (no `version`, so installs track
commits), an entry in [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json), and a
place in a profile. `rsl validate` rejects anything that looks like a credential in a committed
file.

## How it fits together

- **One catalog, three tools.** Codex and Copilot CLI read Claude Code's `.claude-plugin/` format:
  plugin manifests, `skills/`, `hooks/hooks.json` (with `CLAUDE_PLUGIN_ROOT` set) and `.mcp.json`.
  Agents in `agents/` load in Claude Code only.
- **This machine and others.** `install` registers the local checkout, so committed changes reach
  this machine with `rsl update` before they are pushed. Repositories declare the GitHub source,
  so other machines install from GitHub. The two coexist under the same marketplace name.
- **Builds are committed.** Plugin installs copy the plugin folder and run no build, so compiled
  code such as `plugins/workflow/dist/` is committed and CI checks it matches the source. Build
  tooling lives at the repository root so plugin folders stay small.
- **Decisions** are recorded in [`docs/adr/`](docs/adr).

## `rsl` commands

```text
install [--dry-run]                       set up this machine: the marketplace and the CLIs
init <profile|plugin>... [--dir <path>]   set up a repository (--no-codex skips the Codex install)
update                                    pick up changes to agent-workflow-tooling plugins
list                                      profiles and what each plugin provides
doctor                                    check this machine for drift and broken links
validate                                  check this repository (CI runs it)
```

## Develop

```bash
.githooks/setup   # once per clone: git-secrets refuses commits that contain secrets
npm ci
npm run check    # lint, format, rsl and workflow tests, validate, workflow build is current
```

Skill evals live in [`evals/`](evals), outside the plugins so installs stay small.

## License

[MIT](LICENSE)
