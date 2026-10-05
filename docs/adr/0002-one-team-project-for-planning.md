# 2. One team Project for planning

- **Status:** Accepted
- **Date:** 2026-10-04

## Context

Work is planned in sprints. A sprint is one team's commitment for two weeks, and the team works
across every repository: a story can touch the backend and the storefront, and an epic can span
four repositories. A sprint field belongs to one project, so sprints on separate repository boards
are unrelated fields that cannot be added up, and one person's sprint ends up split across boards.
The organization is on GitHub Team, which allows five built-in auto-add workflows per project.

The parent repository holds one system, the commerce platform, not the organization: its README
describes that system, and its submodules are that system's repositories. Names such as `backend`
and `platform` alone do not say which system a repository belongs to.

## Decision

- **Repository names.** The parent repository is `commerce`, and each repository that belongs to
  the system is `commerce-` followed by its folder name: `commerce-platform`, `commerce-backend`,
  `commerce-storefront`, `commerce-admin` and `commerce-checkout`. Inside `commerce`, the submodule
  folders keep the short names, because the prefix would repeat the parent. `design-system` and
  `agent-workflow-tooling` belong to the organization, so they have no prefix; `commerce` includes
  them as submodules because it uses them. The organization is `Reference-Systems-Lab`, and the
  local addresses are `*.rsl-commerce.test`.
- **One team Project.** The organization owns one Project, `commerce work`, linked to every
  repository. It is the board of `commerce` and holds the sprint. No repository has a board of its
  own; each gets a view in the team Project instead.
- **Epics.** Work that spans repositories is an issue in `commerce`, split into sub-issues in the
  repositories that do it. Sub-issues get a sprint. The epic does not, because it spans sprints and
  shows progress through its sub-issues. Work inside one repository is an issue in that repository.
- **Fields.** `Stage` (single select, mirroring the `stage:*` labels, which stay the source of
  truth), `Sprint` (iteration, two weeks), `Estimate` (number) and `Priority` (single select: `P0`,
  `P1`, `P2`).
- **Views.** Current sprint (a board grouped by Stage), Backlog (items with no sprint), Epics
  (`commerce` issues with their sub-issue progress), Roadmap, and one view per repository.
- **Getting items in.** The five auto-add workflows follow `commerce`, `commerce-backend`,
  `commerce-storefront`, `commerce-checkout` and `commerce-admin`. A sub-issue created from an epic
  starts with the epic's projects selected. Other issues in `commerce-platform`, `design-system` and
  `agent-workflow-tooling` are added during backlog refinement.

## Alternatives

- **A board per repository plus an organization board.** Eight places to look, sprints that
  cannot be added up, and repository boards that repeat what a filtered view shows.
- **Sprints on repository boards only.** Splits a person's sprint across boards and leaves
  cross-repository epics without a home.
- **Milestones as sprints.** A milestone belongs to one repository, so each sprint would exist seven
  times. Milestones stay available for a repository's releases.
- **`actions/add-to-project` in every repository** instead of built-in auto-add. It covers all eight
  repositories, but needs a GitHub App or a token kept as a secret, and three repositories added by
  hand do not justify that yet.
- **Other names.** Naming the parent after the organization makes it claim to be the organization.
  Naming the parent `commerce-platform` collides with the prefixed platform repository, and a
  `commerce-platform-` prefix produces `commerce-platform-platform`. Prefixing the folders repeats
  the parent. A brand name belongs to the storefront's identity and can come later without renaming
  a repository.
- **Prefixing `agent-workflow-tooling` and `design-system`.** It would tie organization-wide work to
  one system. About 25 files name `agent-workflow-tooling` as the source of their plugins, and a
  design system is usually shared by every product an organization builds.

## Consequences

- The team plans one sprint in one place, and its estimates add up.
- Issues raised only in `commerce-platform`, `design-system` or `agent-workflow-tooling` reach the
  board when someone adds them. If that becomes a chore, `actions/add-to-project` closes
  the gap.
- A second team gets its own Project. A repository gets its own Project only when it gets its own
  team.
- `gh project field-create` cannot make an iteration field, and `gh` has no command for views, so
  `org-setup` creates `Sprint` and the views through GraphQL. Auto-add workflows, a board's columns
  and a roadmap's dates have no API and are set on github.com.
- `commerce-platform` is the repository that runs the local environment, while the documentation
  calls the whole system the commerce platform.
- A folder's name is its repository's name without the prefix, and `.gitmodules` maps one to the
  other. A clone of the parent lands in `commerce/`, and the documentation uses that name.
