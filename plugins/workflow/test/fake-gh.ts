import type { CliDeps } from '../src/cli-core.js';

interface FakeComment {
  id: number;
  body: string;
  user: { login: string };
}

/** A Project as the board query returns it. */
interface FakeProject {
  id: string;
  number: number;
  title: string;
  closed: boolean;
  fields: { nodes: Array<Record<string, unknown> & { id: string; name: string }> };
}

interface FakeItem {
  id: string;
  projectId: string;
  issue: number;
  /** Field values by field name, as the Project shows them. */
  values: Record<string, string | number>;
}

const select = (
  id: string,
  name: string,
  options: string[],
): Record<string, unknown> & { id: string; name: string } => ({
  __typename: 'ProjectV2SingleSelectField',
  id,
  name,
  options: options.map((o) => ({ id: `${id}:${o}`, name: o })),
});

/** An in-memory stand-in for the parts of GitHub's REST and GraphQL APIs that `worklog` calls through `gh api`. */
export class FakeGitHub {
  viewer = 'owner';
  issues = new Map<
    number,
    {
      body: string | null;
      comments: FakeComment[];
      labels: string[];
      state: string;
      stateReason: string;
      updatedAt: string;
      pr: boolean;
    }
  >();
  calls: Array<{ command: string; args: string[]; input: string | undefined }> = [];
  /** When set, every call fails with this message on stderr. */
  failure: string | null = null;
  private nextId = 100;
  /** The repository's labels. */
  labels = ['bug', 'stage:brief', 'stage:research', 'stage:plan', 'stage:execute', 'stage:review', 'stage:done'];
  /** The Projects linked to the repository. */
  projects: FakeProject[] = [];
  items: FakeItem[] = [];
  /** How many sub-issues each issue has. */
  subIssues = new Map<number, number>();

  /** Links a Project shaped like the team's: Status, Stage, Priority, Estimate and two-week sprints. */
  teamProject(number = 2, title = 'commerce work'): FakeProject {
    const id = `PVT_${number}`;
    const project: FakeProject = {
      id,
      number,
      title,
      closed: false,
      fields: {
        nodes: [
          { __typename: 'ProjectV2Field', id: `${id}:title`, name: 'Title', dataType: 'TITLE' },
          select(`${id}:status`, 'Status', ['Todo', 'In Progress', 'Done']),
          select(`${id}:stage`, 'Stage', ['brief', 'research', 'plan', 'execute', 'review', 'done']),
          select(`${id}:priority`, 'Priority', ['P0', 'P1', 'P2']),
          { __typename: 'ProjectV2Field', id: `${id}:estimate`, name: 'Estimate', dataType: 'NUMBER' },
          {
            __typename: 'ProjectV2IterationField',
            id: `${id}:sprint`,
            name: 'Sprint',
            configuration: {
              iterations: [
                { id: `${id}:s3`, title: 'Sprint 3', startDate: '2026-10-19', duration: 14 },
                { id: `${id}:s2`, title: 'Sprint 2', startDate: '2026-10-05', duration: 14 },
              ],
            },
          },
        ],
      },
    };
    this.projects.push(project);
    return project;
  }

  /** The issue's field values on the Project, or undefined when it is not on it. */
  item(issue: number, projectId = 'PVT_2'): Record<string, string | number> | undefined {
    return this.items.find((i) => i.issue === issue && i.projectId === projectId)?.values;
  }

  issue(
    number: number,
    body: string | null = '',
    meta: {
      labels?: string[];
      state?: 'open' | 'closed';
      stateReason?: 'completed' | 'not_planned';
      updatedAt?: string;
      pr?: boolean;
    } = {},
  ): void {
    this.issues.set(number, {
      body,
      comments: [],
      labels: meta.labels ?? [],
      state: meta.state ?? 'open',
      stateReason: meta.stateReason ?? 'completed',
      updatedAt: meta.updatedAt ?? '2026-10-01T00:00:00Z',
      pr: meta.pr ?? false,
    });
  }

  comment(number: number, author: string, body: string): number {
    const id = this.nextId++;
    this.issues.get(number)?.comments.push({ id, body, user: { login: author } });
    return id;
  }

  comments(number: number): FakeComment[] {
    return this.issues.get(number)?.comments ?? [];
  }

  exec: CliDeps['exec'] = (command, args, input) => {
    this.calls.push({ command, args, input });
    if (this.failure !== null) return { status: 1, stdout: '', stderr: this.failure };
    if (command !== 'gh' || args[0] !== 'api') return notFound(`unexpected command ${command} ${args.join(' ')}`);
    if (args[1] === 'graphql') return this.graphql(args.slice(2), input);
    const methodAt = args.indexOf('--method');
    const method = methodAt === -1 ? 'GET' : args[methodAt + 1];
    const path = args.find((a) => a === 'user' || a.startsWith('repos/')) ?? '';
    const payload =
      input === undefined || input === '' ? {} : (JSON.parse(input) as { body?: string; labels?: string[] });
    if (path === 'user') return ok({ login: this.viewer });

    if (/^repos\/[^/]+\/[^/]+\/issues\?/.test(path)) {
      // --paginate --slurp: one page holding every issue, newest first like GitHub.
      const list = [...this.issues.entries()].reverse().map(([number, i]) => ({
        number,
        labels: i.labels.map((name) => ({ name })),
        state: i.state,
        state_reason: i.state === 'closed' ? i.stateReason : null,
        updated_at: i.updatedAt,
        comments: i.comments.length,
        ...(i.pr ? { pull_request: {} } : {}),
      }));
      return ok([list]);
    }
    const issuePath = /^repos\/[^/]+\/[^/]+\/issues\/(\d+)$/.exec(path);
    const commentsPath = /^repos\/[^/]+\/[^/]+\/issues\/(\d+)\/comments$/.exec(path);
    const commentPath = /^repos\/[^/]+\/[^/]+\/issues\/comments\/(\d+)$/.exec(path);
    const labelsPath = /^repos\/[^/]+\/[^/]+\/issues\/(\d+)\/labels(?:\/([^/]+))?$/.exec(path);
    if (labelsPath) {
      const issue = this.issues.get(Number(labelsPath[1]));
      if (!issue) return notFound('Not Found (HTTP 404)');
      const name = labelsPath[2] === undefined ? undefined : decodeURIComponent(labelsPath[2]);
      if (method === 'DELETE' && name !== undefined) {
        if (!issue.labels.includes(name)) return notFound('Label does not exist (HTTP 404)');
        issue.labels = issue.labels.filter((l) => l !== name);
      } else if (method === 'POST' && name === undefined) {
        for (const label of payload.labels ?? []) if (!issue.labels.includes(label)) issue.labels.push(label);
      } else return notFound('Not Found (HTTP 404)');
      return ok(issue.labels.map((l) => ({ name: l })));
    }
    if (issuePath) {
      const number = Number(issuePath[1]);
      const issue = this.issues.get(number);
      if (!issue) return notFound('Not Found (HTTP 404)');
      if (method === 'PATCH') issue.body = payload.body ?? issue.body;
      return ok({ number, body: issue.body });
    }
    if (commentsPath) {
      const number = Number(commentsPath[1]);
      const issue = this.issues.get(number);
      if (!issue) return notFound('Not Found (HTTP 404)');
      if (method === 'POST') {
        const id = this.comment(number, this.viewer, payload.body ?? '');
        return ok({ id });
      }
      // --paginate --slurp: an array of pages, two comments per page.
      const pages: FakeComment[][] = [];
      for (let i = 0; i < issue.comments.length; i += 2) pages.push(issue.comments.slice(i, i + 2));
      return ok(pages);
    }
    if (commentPath && method === 'PATCH') {
      const id = Number(commentPath[1]);
      for (const issue of this.issues.values()) {
        const found = issue.comments.find((c) => c.id === id);
        if (found) {
          found.body = payload.body ?? found.body;
          return ok({ id });
        }
      }
    }
    return notFound('Not Found (HTTP 404)');
  };

  /** `gh api graphql`: the board query takes -f/-F fields; the mutations send JSON on stdin. */
  private graphql(args: string[], input: string | undefined): { status: number; stdout: string; stderr: string } {
    const fields: Record<string, string> = {};
    for (let i = 0; i < args.length; i += 2) {
      const [key = '', ...value] = (args[i + 1] ?? '').split('=');
      if (args[i] === '-f' || args[i] === '-F') fields[key] = value.join('=');
    }
    const request =
      input === undefined
        ? { query: fields['query'] ?? '', variables: fields as Record<string, unknown> }
        : (JSON.parse(input) as { query: string; variables: Record<string, unknown> });
    const v = request.variables;
    const operation = /^(?:query|mutation) (\w+)/.exec(request.query)?.[1];
    if (operation === 'WorklogBoard') {
      const number = Number(v['number']);
      const issue = this.issues.get(number);
      if (!issue) return notFound(`Could not resolve to an Issue with the number of ${number}.`);
      const owner = v['owner'] === '{owner}' ? 'acme' : String(v['owner']);
      const name = v['name'] === '{repo}' ? 'widgets' : String(v['name']);
      return ok({
        data: {
          repository: {
            nameWithOwner: `${owner}/${name}`,
            labels: { nodes: this.labels.filter((l) => l.includes('stage:')).map((l) => ({ name: l })) },
            issue: {
              id: `I_${number}`,
              labels: { nodes: issue.labels.map((l) => ({ name: l })) },
              subIssuesSummary: { total: this.subIssues.get(number) ?? 0 },
              projectItems: {
                nodes: this.items
                  .filter((i) => i.issue === number)
                  .map((i) => ({ id: i.id, project: { id: i.projectId } })),
              },
            },
            projectsV2: { nodes: this.projects },
          },
        },
      });
    }
    if (operation === 'WorklogAddItem') {
      const issue = Number(String(v['content']).replace(/^I_/, ''));
      const projectId = String(v['project']);
      let item = this.items.find((i) => i.issue === issue && i.projectId === projectId);
      if (!item) {
        item = { id: `PVTI_${this.nextId++}`, projectId, issue, values: {} };
        this.items.push(item);
      }
      return ok({ data: { addProjectV2ItemById: { item: { id: item.id } } } });
    }
    if (operation === 'WorklogSetField' || operation === 'WorklogClearField') {
      const item = this.items.find((i) => i.id === v['item']);
      const field = this.projects.find((p) => p.id === v['project'])?.fields.nodes.find((f) => f.id === v['field']);
      if (!item || !field) return notFound('Could not resolve to a node with the global id.');
      const value = v['value'] as { singleSelectOptionId?: string; iterationId?: string; number?: number } | undefined;
      const options = (field['options'] ?? []) as Array<{ id: string; name: string }>;
      const iterations =
        (field['configuration'] as { iterations?: Array<{ id: string; title: string }> } | undefined)?.iterations ?? [];
      if (value === undefined) delete item.values[field.name];
      else if (value.singleSelectOptionId !== undefined) {
        const found = options.find((o) => o.id === value.singleSelectOptionId);
        if (!found) return notFound('The single select option Id does not belong to the field');
        item.values[field.name] = found.name;
      } else if (value.iterationId !== undefined) {
        const found = iterations.find((i) => i.id === value.iterationId);
        if (!found) return notFound('The iteration Id does not belong to the field');
        item.values[field.name] = found.title;
      } else if (value.number !== undefined) item.values[field.name] = value.number;
      const key = operation === 'WorklogSetField' ? 'updateProjectV2ItemFieldValue' : 'clearProjectV2ItemFieldValue';
      return ok({ data: { [key]: { projectV2Item: { id: item.id } } } });
    }
    return notFound(`unexpected GraphQL operation ${operation ?? request.query.slice(0, 40)}`);
  }
}

function ok(value: unknown): { status: number; stdout: string; stderr: string } {
  return { status: 0, stdout: JSON.stringify(value), stderr: '' };
}

function notFound(message: string): { status: number; stdout: string; stderr: string } {
  return { status: 1, stdout: '', stderr: `gh: ${message}` };
}
