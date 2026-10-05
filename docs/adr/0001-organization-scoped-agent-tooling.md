# 1. Agent tooling scoped to the organization

- **Status:** Accepted
- **Date:** 2026-10-04

## Context

This repository started as a copy of agent-station, one person's setup for coding agents: a plugin
marketplace and a `station` CLI that installed a base set of plugins for the whole machine, linked
one global instructions file into every tool, and kept a secrets file for personal MCP servers. It
also carried a research plugin built around a private Obsidian vault and NotebookLM.

Reference Systems Lab needs something different: every contributor, whether they use Claude Code,
Codex or GitHub Copilot, should work the same way on the lab's repositories, without the lab's
tooling changing how their agents behave anywhere else. Each repository is its own unit of work,
and the organization is the whole.

## Decision

- **Scope.** Plugins are enabled per project only: in the `commerce/` folder and in
  each repository, through committed project settings. `rsl install` registers the marketplace and
  links the `rsl` and `worklog` CLIs, and enables nothing. Codex, which cannot install per project,
  gets every plugin `rsl init` installs switched off at user level and on in the project.
- **Profiles per repository.** `base` (workflow, org, context7) is in every profile and is what the
  parent folder uses. `storefront`, `admin`, `checkout` and `design-system` add frontend and
  playwright; `backend`, `platform` and `agent-workflow-tooling` are `base` until they have their
  own skills. A repository's
  own skills and agents go in a plugin added to its profile.
- **Names.** The CLI is `rsl` (Reference Systems Lab), in `cli/`. The base plugin is `workflow`,
  which also names its issue markers (`<!-- workflow:section … -->`). `worklog`, `org`, `frontend`
  and the marketplace name `agent-workflow-tooling` are unchanged.
- **Removed.** The research plugin and its evals, `global/AGENTS.md` and the step that linked it,
  the secrets file with the checks built around it (the `install` step, the `doctor` scans of tool
  configs for plaintext MCP keys, and `validate`'s rule against `${VAR}` in `.mcp.json`), and the
  agent-station planning and review documents.

## Alternatives

- **Keep a base profile installed for the whole machine.** Simplest to set up, but the lab's skills
  and hooks would run in every codebase a contributor touches.
- **Profiles per discipline** (`frontend`, `backend`, `platform`). Fewer profiles, but no place for
  one repository's own skills without a second mechanism.
- **Keep `devflow` and `station`.** No renames, but the names explain nothing to a new contributor,
  and `devflow` would collide with the agent-station copy on the maintainer's machine. Renaming
  costs nothing before the organization has issues; afterwards the issue markers would need
  migrating.
- **Keep the secrets handling** for future MCP servers. No plugin here needs a key today; it comes
  back with the first one that does.

## Consequences

- A contributor runs `rsl install` once, and each repository runs `rsl init <profile>` once and
  commits the result. Outside those folders their agents are unchanged.
- Claude Code was checked: a plugin installed from a repository's settings is enabled there and
  disabled elsewhere. Codex was checked to switch the plugins off at user level. Whether Copilot
  CLI keeps plugins from `.github/copilot/settings.json` to that repository could not be checked
  without an interactive session, and is still to be confirmed.
- Copilot CLI only installs plugins from this marketplace, so its users miss `context7` and
  `playwright`, and `worklog` does not yet recognise Copilot sessions, so their time is not
  measured.
- No secrets mechanism exists. A plugin that needs a key must add one, keeping in mind that Codex
  does not expand `${VAR}` in plugin MCP config.
