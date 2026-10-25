import type { BoardContext, FieldWrite, Iteration, ProjectField } from './board.js';
import {
  checkBodySize,
  findMarkedComment,
  markedComment,
  readSection,
  setSection,
  type IssueComment,
} from './issue.js';

/** Runs an external command, optionally feeding it stdin, and reports how it ended. */
export type Exec = (
  command: string,
  args: string[],
  input?: string,
) => { status: number; stdout: string; stderr: string };

/** The issue, its stage labels and Project items, and the Projects linked to its repository. */
const BOARD_QUERY = `query WorklogBoard($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    nameWithOwner
    labels(first: 100, query: "stage:") { nodes { name } }
    issue(number: $number) {
      id
      labels(first: 100) { nodes { name } }
      subIssuesSummary { total }
      projectItems(first: 50) { nodes { id project { id } } }
    }
    projectsV2(first: 20) {
      nodes {
        id number title closed
        fields(first: 50) {
          nodes {
            __typename
            ... on ProjectV2Field { id name dataType }
            ... on ProjectV2SingleSelectField { id name options { id name } }
            ... on ProjectV2IterationField { id name configuration { iterations { id title startDate duration } } }
          }
        }
      }
    }
  }
}`;

const ADD_ITEM = `mutation WorklogAddItem($project: ID!, $content: ID!) {
  addProjectV2ItemById(input: { projectId: $project, contentId: $content }) { item { id } }
}`;

const SET_FIELD = `mutation WorklogSetField($project: ID!, $item: ID!, $field: ID!, $value: ProjectV2FieldValue!) {
  updateProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field, value: $value }) {
    projectV2Item { id }
  }
}`;

const CLEAR_FIELD = `mutation WorklogClearField($project: ID!, $item: ID!, $field: ID!) {
  clearProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $field }) {
    projectV2Item { id }
  }
}`;

interface RawField {
  __typename: string;
  id: string;
  name: string;
  dataType?: string;
  options?: Array<{ id: string; name: string }>;
  configuration?: { iterations: Iteration[] };
}

function projectField(raw: RawField): ProjectField {
  const { id, name } = raw;
  if (raw.__typename === 'ProjectV2SingleSelectField') return { kind: 'select', id, name, options: raw.options ?? [] };
  if (raw.__typename === 'ProjectV2IterationField') {
    return { kind: 'iteration', id, name, iterations: raw.configuration?.iterations ?? [] };
  }
  return raw.dataType === 'NUMBER' ? { kind: 'number', id, name } : { kind: 'other', id, name };
}

/** Talks to one repository's issues through `gh api`; PRs share the issue endpoints, so they work too. */
export class GitHub {
  constructor(
    private readonly exec: Exec,
    /** `owner/repo`, or undefined to let `gh` take it from the current directory. */
    private readonly repo: string | undefined,
  ) {}

  private path(rest: string): string {
    return `repos/${this.repo ?? '{owner}/{repo}'}/${rest}`;
  }

  private api(args: string[], payload?: object): unknown {
    const input = payload === undefined ? undefined : JSON.stringify(payload);
    const result = this.exec('gh', ['api', ...args, ...(input === undefined ? [] : ['--input', '-'])], input);
    if (result.status !== 0) {
      const path = args.find((a) => a === 'user' || a === 'graphql' || a.startsWith('repos/')) ?? args.join(' ');
      throw new Error(`gh api ${path} failed: ${(result.stderr || result.stdout).trim()}`);
    }
    return JSON.parse(result.stdout || 'null') as unknown;
  }

  private login: string | undefined;

  viewer(): string {
    this.login ??= (this.api(['user']) as { login: string }).login;
    return this.login;
  }

  /** Every issue and pull request in the repository, open and closed. */
  issues(): Array<{
    issue: number;
    labels: string[];
    updatedAt: string;
    closed: boolean;
    /** Closed as done, not as "not planned". */
    completed: boolean;
    comments: number;
    pullRequest: boolean;
  }> {
    const pages = this.api(['--paginate', '--slurp', this.path('issues?state=all&per_page=100')]) as Array<
      Array<{
        number: number;
        labels: Array<{ name: string } | string>;
        updated_at: string;
        state: string;
        state_reason?: string | null;
        comments: number;
        pull_request?: unknown;
      }>
    >;
    return pages.flat().map((i) => ({
      issue: i.number,
      labels: i.labels.map((l) => (typeof l === 'string' ? l : l.name)),
      updatedAt: i.updated_at,
      closed: i.state === 'closed',
      completed: i.state === 'closed' && i.state_reason !== 'not_planned',
      comments: i.comments,
      pullRequest: i.pull_request !== undefined,
    }));
  }

  body(issue: number): string {
    return (this.api([this.path(`issues/${issue}`)]) as { body: string | null }).body ?? '';
  }

  comments(issue: number): IssueComment[] {
    const pages = this.api(['--paginate', '--slurp', this.path(`issues/${issue}/comments`)]) as Array<
      Array<{ id: number; body: string | null; user: { login: string } | null }>
    >;
    return pages.flat().map((c) => ({ id: c.id, author: c.user?.login ?? '', body: c.body ?? '' }));
  }

  /** The text of one marked section of the issue body, or null when it has none. */
  section(issue: number, name: string): string | null {
    return readSection(this.body(issue), name);
  }

  /** Replaces or appends one marked section of the issue body. Returns whether it was added. */
  setSection(issue: number, name: string, content: string): 'added' | 'updated' {
    const before = this.body(issue);
    const existed = readSection(before, name) !== null;
    const after = setSection(before, name, content);
    checkBodySize(after);
    this.api(['--method', 'PATCH', this.path(`issues/${issue}`)], { body: after });
    return existed ? 'updated' : 'added';
  }

  /** This account's comment for `key`, if it has posted one. */
  markedComment(issue: number, key: string): IssueComment | undefined {
    return findMarkedComment(this.comments(issue), key, this.viewer());
  }

  /** Edits this account's comment for `key`, or creates it when there is none yet. */
  upsertComment(issue: number, key: string, content: string, provenance: string): 'created' | 'updated' {
    const body = markedComment(key, content, provenance);
    checkBodySize(body);
    const existing = this.markedComment(issue, key);
    if (existing) {
      this.api(['--method', 'PATCH', this.path(`issues/comments/${existing.id}`)], { body });
      return 'updated';
    }
    this.api(['--method', 'POST', this.path(`issues/${issue}/comments`)], { body });
    return 'created';
  }

  /** A GraphQL call whose variables go as JSON on stdin, so IDs and numbers keep their types. */
  private graphql(query: string, variables: Record<string, unknown>): unknown {
    return (this.api(['graphql'], { query, variables }) as { data: unknown }).data;
  }

  /** What `worklog issue board` needs to know before it writes anything. */
  boardContext(issue: number): BoardContext {
    const [owner, name] = this.repo?.split('/') ?? [];
    // `gh` fills the {owner} and {repo} placeholders only in -F fields, from the current directory.
    const where =
      owner === undefined || name === undefined
        ? ['-F', 'owner={owner}', '-F', 'name={repo}']
        : ['-f', `owner=${owner}`, '-f', `name=${name}`];
    const data = this.api(['graphql', ...where, '-F', `number=${issue}`, '-f', `query=${BOARD_QUERY}`]) as {
      data: {
        repository: {
          nameWithOwner: string;
          labels: { nodes: Array<{ name: string }> };
          issue: {
            id: string;
            labels: { nodes: Array<{ name: string }> };
            subIssuesSummary: { total: number };
            projectItems: { nodes: Array<{ id: string; project: { id: string } }> };
          };
          projectsV2: {
            nodes: Array<{
              id: string;
              number: number;
              title: string;
              closed: boolean;
              fields: { nodes: RawField[] };
            }>;
          };
        };
      };
    };
    const repo = data.data.repository;
    return {
      repo: repo.nameWithOwner,
      stageLabels: repo.labels.nodes.map((l) => l.name).filter((l) => l.startsWith('stage:')),
      issue: {
        id: repo.issue.id,
        labels: repo.issue.labels.nodes.map((l) => l.name),
        subIssues: repo.issue.subIssuesSummary.total,
        items: new Map(repo.issue.projectItems.nodes.map((i) => [i.project.id, i.id])),
      },
      projects: repo.projectsV2.nodes.map((p) => ({
        id: p.id,
        number: p.number,
        title: p.title,
        closed: p.closed,
        fields: p.fields.nodes.map(projectField),
      })),
    };
  }

  addLabel(issue: number, label: string): void {
    this.api(['--method', 'POST', this.path(`issues/${issue}/labels`)], { labels: [label] });
  }

  removeLabel(issue: number, label: string): void {
    this.api(['--method', 'DELETE', this.path(`issues/${issue}/labels/${encodeURIComponent(label)}`)]);
  }

  /** The issue's item on the Project; GitHub returns the existing item when it is already there. */
  addToProject(projectId: string, contentId: string): string {
    const data = this.graphql(ADD_ITEM, { project: projectId, content: contentId }) as {
      addProjectV2ItemById: { item: { id: string } };
    };
    return data.addProjectV2ItemById.item.id;
  }

  setField(projectId: string, itemId: string, write: FieldWrite): void {
    const ids = { project: projectId, item: itemId, field: write.fieldId };
    if (write.value === undefined) this.graphql(CLEAR_FIELD, ids);
    else this.graphql(SET_FIELD, { ...ids, value: write.value });
  }
}
