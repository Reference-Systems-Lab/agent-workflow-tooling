# 3. Workflow skills keep the team Project in step

- **Status:** Accepted
- **Date:** 2026-10-25

## Context

ADR 2 plans every repository's work on one team Project. Its `Stage` field mirrors the `stage:*`
labels, and its `Sprint` field holds two-week sprints. Getting items in was left to the built-in
auto-add workflows, which follow five repositories, and to backlog refinement for the other three.

Three weeks later the Current sprint board was empty (agent-workflow-tooling#13):

- None of the 16 items had Sprint, Stage, Priority or Estimate set. Auto-add creates an item and the
  built-in workflows set Status; nothing set the rest.
- Three issues, in `commerce-platform`, `design-system` and `agent-workflow-tooling`, were not on the
  Project at all. No step of the workflow does backlog refinement.
- Nothing mirrored the labels to Stage.

The workflow skills already write the rest of an issue's record through `worklog`: its sections,
keyed comments and time. They are also the only place that knows when an issue opens, changes stage
or gets its estimate.

## Decision

- **`worklog issue board N`** keeps the issue's item on the Project in step:
  - it adds the issue to the open Project linked to its repository, and a repeat run adds nothing;
  - it sets `Stage` from the `stage:*` label, swapping the label first when given `--stage`;
  - when given them, it sets `Sprint` (current, next or none), `Estimate` (in hours) and
    `Priority`.

  It reads and checks everything before it writes. In a repository with no linked Project it only
  swaps the label.

- **The skills run it** wherever they open an issue or move its stage. That covers the five
  `feature-*` stages, `bugfix` records and the deferred follow-ups from `feedback`. The contract
  describes this in its Team Project section.
- **Defaults.** A new issue joins the current sprint unless the user puts it in the backlog. An epic
  takes no sprint, and the command refuses one. Priority is asked with the question that agrees to
  open the issue. Estimate is the plan's total.
- **The labels stay the source of truth**; Stage mirrors them.
- **This supersedes "Getting items in" in ADR 2.** The auto-add workflows stay, as a net for issues
  opened by hand in the five repositories they follow. Backlog refinement is no longer how the other
  three repositories' issues get in.

## Alternatives

- **`gh project` commands written into the skills.** No code to keep. But each stage change needs
  the Project, item, field and option IDs looked up first. That is four or five calls an agent can
  get wrong or skip, and skipping is how the board fell behind.
- **`actions/add-to-project` and a label-to-Stage workflow in every repository.** It catches issues
  opened by hand too. But it needs a GitHub App or a token kept as a secret in eight repositories,
  which ADR 2 turned down. An Action also cannot know the sprint, estimate or priority a person
  decided.
- **Auto-add plus backlog refinement by hand.** That was the state before this decision, and it left
  the sprint board empty.

## Consequences

- An issue opened through the skills is on the board and in the current sprint from the moment it
  opens, in any of the eight repositories.
- `worklog` needs the `project` scope, which `org-setup` already asks for (`gh auth refresh -s project`).
- Some issues opened by hand on github.com reach the board only when someone runs
  `worklog issue board N`. That applies in `commerce-platform`, `design-system` and
  `agent-workflow-tooling`; the five auto-add workflows catch the rest, without a sprint.
- `--sprint current` needs a sprint that covers today. When the Sprint field runs out of iterations,
  the command fails and says to add more on github.com.
- Settings with no API stay manual, as in ADR 2: the auto-add workflows, the board's columns and the
  roadmap's dates.
