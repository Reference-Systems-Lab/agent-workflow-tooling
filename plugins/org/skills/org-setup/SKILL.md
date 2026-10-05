---
name: org-setup
description: >-
  Sets up a Reference-Systems-Lab repository the way the workflow plugin expects: the label set, a
  ruleset on the default branch, CODEOWNERS, the team Project that plans every repository's work,
  and the organization's profile README. Use when the user asks to set up, bootstrap or harden
  an organization repository, to add the org profile, or to check that a repository has the team
  infrastructure in place. Not for creating or transferring the organization itself.
---

# Org setup

Brings one organization repository up to the shape the workflow plugin assumes, and leaves what is
already right alone. Every step is a check first, then a change only when the check fails. Needs the
`gh` CLI authenticated with admin rights on the repository and the `project` scope for the team
Project (`gh auth refresh -s project`).

## Before changing anything

- Resolve the repository: `gh repo view --json nameWithOwner,owner,visibility,defaultBranchRef`.
  Stop if the owner is a user account: rulesets and Projects behave differently there.
- **Say what is public.** Each step below publishes under the user's account, and on a public
  repository anyone can read it. Ask before the first change and before each step marked _ask_.
- Report the checks as a list (in place, missing, differs) and let the user choose what to apply.

## Steps

1. **Labels** (_ask_). Compare `gh label list` with the label set in
   `plugins/workflow/contract/feature-workflow.md`, section Labels: `type:feature`, `type:spike`,
   `type:chore`; `track:quick`, `track:standard`, `track:full`; `stage:brief`, `stage:research`,
   `stage:plan`, `stage:execute`, `stage:review`, `stage:done`; plus `bug`. Create what is missing
   with `gh label create`. Read the contract if the repository has a newer copy; it wins over this list.
2. **Ruleset on the default branch** (_ask_). List `gh api repos/{owner}/{repo}/rulesets`. If none
   protects the default branch, create it from `references/ruleset-main.json`:
   `gh api --method POST repos/{owner}/{repo}/rulesets --input -`. First replace the required check
   name `validate` with a job that exists in the repository's workflows; a check that never runs
   blocks every merge. Required approvals stay at 0 while the organization has one human, because
   nobody can approve their own pull request. Raise `required_approving_review_count` to 1 and set
   `require_code_owner_review` to true when a second person joins, and say that in the report.
3. **CODEOWNERS** (_ask_). If `.github/CODEOWNERS` is missing, write it from
   `references/CODEOWNERS.template` with the owner the user names (a user or a team that has write
   access). Never leave the `OWNER` placeholder in a committed file. Deliver it as a pull request
   when the ruleset is already active.
4. **Security policy.** `rsl init` already copies `scaffold/.github/SECURITY.md` into the project,
   since every profile includes this plugin; confirm it is there.
5. **Team Project** (_ask_). One Project, owned by the organization, plans the work of every
   repository, sprints included (ADR 2 in agent-workflow-tooling). No repository has a board of its
   own. `gh project list --owner {owner}` shows whether it exists.
   - **Create it once**, for the first repository set up:
     `gh project create --owner {owner} --title "commerce work"`, then make it public with
     `gh project edit <number> --owner {owner} --visibility PUBLIC`. If `gh project create` fails
     (gh 2.87 sends a broken query), use the GraphQL mutation `createProjectV2` with the
     organization's ID. It is the board of the parent repository, `commerce`, whose issues are
     epics: work that spans repositories, split into sub-issues in the repositories that do it.
     Sub-issues get a sprint; epics do not.
   - **Fields**, created with the Project. `Stage`, `Priority` and `Estimate` come from
     `gh project field-create`:

     ```bash
     gh project field-create <number> --owner {owner} --name Stage --data-type SINGLE_SELECT \
       --single-select-options "brief,research,plan,execute,review,done"
     gh project field-create <number> --owner {owner} --name Priority --data-type SINGLE_SELECT \
       --single-select-options "P0,P1,P2"
     gh project field-create <number> --owner {owner} --name Estimate --data-type NUMBER
     ```

     `Sprint` is an iteration field of 14 days, which `gh project field-create` cannot make. Ask
     the user for the first sprint's start date, then call the GraphQL mutation
     `createProjectV2Field` with `dataType: ITERATION`, `name: "Sprint"` and an
     `iterationConfiguration` of that `startDate`, `duration: 14` and three iterations, `Sprint 1`
     to `Sprint 3`, so the next sprint can be planned. The project ID comes from
     `gh project view <number> --owner {owner} --format json --jq .id`.

   - **Link the repository**: `gh project link <number> --owner {owner} --repo {owner}/{repo}`, so
     the Project shows on the repository's Projects tab.
   - **Views**, created with the GraphQL mutations `createProjectV2View` (name, layout, visible
     fields) and `updateProjectV2View` (filter). Turn the default "View 1" into the first one:
     - Current sprint: a board filtered with `sprint:@current`;
     - Backlog: a table filtered with `is:open no:sprint`;
     - Epics: a table filtered with `repo:{owner}/commerce`, showing Sub-issues progress;
     - Roadmap, filtered with `is:open` (roadmaps take no visible fields);
     - one table per repository, named after its folder and filtered with `repo:{owner}/{repo}`.
       Add the repository's view when linking it.

     Two settings have no API and are set on github.com: the Current sprint board's columns
     (Stage) and the Roadmap's dates (Sprint).

   The `stage:*` labels stay the source of truth; the Project only mirrors them. Issues reach the
   Project through its built-in auto-add workflows, set in its Workflows settings on github.com.
   Each follows one repository, and GitHub Team allows 5: they follow `commerce`,
   `commerce-backend`, `commerce-storefront`, `commerce-checkout` and `commerce-admin`. A sub-issue
   created from an epic starts with the epic's projects selected. Other issues in
   `commerce-platform`, `design-system` and `agent-workflow-tooling` are added during
   backlog refinement. Check the auto-add workflows and views are set and list any that are missing
   in the report.

6. **Organization profile** (_ask_). The profile is a README in the organization's `.github`
   repository at `profile/README.md`. If `{owner}/.github` does not exist, ask before creating it
   (`gh repo create {owner}/.github --public`); if it does, add the file only when it is missing.
   Start from `references/profile-README.md`, fill `ORG_NAME`, and keep it to what is true today:
   how work moves, and which repositories to look at.
7. **Auto-close setting.** The workflow plugin needs "Auto-close issues with merged linked pull
   requests" turned off. The agent cannot change it; follow the contract's section on that setting.

## Report

End with what was in place, what changed, what the user must still do themselves (the auto-add
workflows, board columns and roadmap dates from step 5, the setting in step 7, and
`gh auth refresh` if a scope was missing), and the one-human caveat from step 2.
