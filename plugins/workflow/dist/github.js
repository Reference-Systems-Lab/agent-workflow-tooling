import { checkBodySize, findMarkedComment, markedComment, readSection, setSection, } from './issue.js';
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
function projectField(raw) {
    const { id, name } = raw;
    if (raw.__typename === 'ProjectV2SingleSelectField')
        return { kind: 'select', id, name, options: raw.options ?? [] };
    if (raw.__typename === 'ProjectV2IterationField') {
        return { kind: 'iteration', id, name, iterations: raw.configuration?.iterations ?? [] };
    }
    return raw.dataType === 'NUMBER' ? { kind: 'number', id, name } : { kind: 'other', id, name };
}
/** Talks to one repository's issues through `gh api`; PRs share the issue endpoints, so they work too. */
export class GitHub {
    exec;
    repo;
    constructor(exec, 
    /** `owner/repo`, or undefined to let `gh` take it from the current directory. */
    repo) {
        this.exec = exec;
        this.repo = repo;
    }
    path(rest) {
        return `repos/${this.repo ?? '{owner}/{repo}'}/${rest}`;
    }
    api(args, payload) {
        const input = payload === undefined ? undefined : JSON.stringify(payload);
        const result = this.exec('gh', ['api', ...args, ...(input === undefined ? [] : ['--input', '-'])], input);
        if (result.status !== 0) {
            const path = args.find((a) => a === 'user' || a === 'graphql' || a.startsWith('repos/')) ?? args.join(' ');
            throw new Error(`gh api ${path} failed: ${(result.stderr || result.stdout).trim()}`);
        }
        return JSON.parse(result.stdout || 'null');
    }
    login;
    viewer() {
        this.login ??= this.api(['user']).login;
        return this.login;
    }
    /** Every issue and pull request in the repository, open and closed. */
    issues() {
        const pages = this.api(['--paginate', '--slurp', this.path('issues?state=all&per_page=100')]);
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
    body(issue) {
        return this.api([this.path(`issues/${issue}`)]).body ?? '';
    }
    comments(issue) {
        const pages = this.api(['--paginate', '--slurp', this.path(`issues/${issue}/comments`)]);
        return pages.flat().map((c) => ({ id: c.id, author: c.user?.login ?? '', body: c.body ?? '' }));
    }
    /** The text of one marked section of the issue body, or null when it has none. */
    section(issue, name) {
        return readSection(this.body(issue), name);
    }
    /** Replaces or appends one marked section of the issue body. Returns whether it was added. */
    setSection(issue, name, content) {
        const before = this.body(issue);
        const existed = readSection(before, name) !== null;
        const after = setSection(before, name, content);
        checkBodySize(after);
        this.api(['--method', 'PATCH', this.path(`issues/${issue}`)], { body: after });
        return existed ? 'updated' : 'added';
    }
    /** This account's comment for `key`, if it has posted one. */
    markedComment(issue, key) {
        return findMarkedComment(this.comments(issue), key, this.viewer());
    }
    /** Edits this account's comment for `key`, or creates it when there is none yet. */
    upsertComment(issue, key, content, provenance) {
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
    graphql(query, variables) {
        return this.api(['graphql'], { query, variables }).data;
    }
    /** What `worklog issue board` needs to know before it writes anything. */
    boardContext(issue) {
        const [owner, name] = this.repo?.split('/') ?? [];
        // `gh` fills the {owner} and {repo} placeholders only in -F fields, from the current directory.
        const where = owner === undefined || name === undefined
            ? ['-F', 'owner={owner}', '-F', 'name={repo}']
            : ['-f', `owner=${owner}`, '-f', `name=${name}`];
        const data = this.api(['graphql', ...where, '-F', `number=${issue}`, '-f', `query=${BOARD_QUERY}`]);
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
    addLabel(issue, label) {
        this.api(['--method', 'POST', this.path(`issues/${issue}/labels`)], { labels: [label] });
    }
    removeLabel(issue, label) {
        this.api(['--method', 'DELETE', this.path(`issues/${issue}/labels/${encodeURIComponent(label)}`)]);
    }
    /** The issue's item on the Project; GitHub returns the existing item when it is already there. */
    addToProject(projectId, contentId) {
        const data = this.graphql(ADD_ITEM, { project: projectId, content: contentId });
        return data.addProjectV2ItemById.item.id;
    }
    setField(projectId, itemId, write) {
        const ids = { project: projectId, item: itemId, field: write.fieldId };
        if (write.value === undefined)
            this.graphql(CLEAR_FIELD, ids);
        else
            this.graphql(SET_FIELD, { ...ids, value: write.value });
    }
}
