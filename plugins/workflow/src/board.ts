/**
 * The Project an issue is planned on: which linked Project to use, which sprint a date falls in, and
 * which field values one `worklog issue board` run writes. Pure functions; `github.ts` does the calls.
 */

export const STAGES = ['brief', 'research', 'plan', 'execute', 'review', 'done'] as const;
export type Stage = (typeof STAGES)[number];

export const SPRINTS = ['current', 'next', 'none'] as const;
export type Sprint = (typeof SPRINTS)[number];

export interface Iteration {
  id: string;
  title: string;
  /** YYYY-MM-DD. */
  startDate: string;
  /** Days. */
  duration: number;
}

export type ProjectField =
  | { kind: 'select'; id: string; name: string; options: Array<{ id: string; name: string }> }
  | { kind: 'iteration'; id: string; name: string; iterations: Iteration[] }
  | { kind: 'number'; id: string; name: string }
  | { kind: 'other'; id: string; name: string };

export interface Project {
  id: string;
  number: number;
  title: string;
  closed: boolean;
  fields: ProjectField[];
}

export interface BoardContext {
  /** `owner/repo`. */
  repo: string;
  /** The repository's `stage:*` labels, so a swap never creates one. */
  stageLabels: string[];
  issue: {
    id: string;
    labels: string[];
    subIssues: number;
    /** The issue's item on each Project it is already on, by Project ID. */
    items: Map<string, string>;
  };
  /** The Projects linked to the repository. */
  projects: Project[];
}

/** One field value to set, or to clear when `value` is absent. */
export interface FieldWrite {
  field: string;
  fieldId: string;
  value?: { singleSelectOptionId: string } | { iterationId: string } | { number: number };
  /** How the value reads in the report. */
  shown: string;
}

export interface BoardRequest {
  sprint?: Sprint;
  estimateMin?: number;
  priority?: string;
}

export function isStage(raw: string): raw is Stage {
  return (STAGES as readonly string[]).includes(raw);
}

export function isSprint(raw: string): raw is Sprint {
  return (SPRINTS as readonly string[]).includes(raw);
}

/** The open Project linked to the repository, or null when none is; `number` picks among several. */
export function chooseProject(projects: Project[], number?: number): Project | null {
  const open = projects.filter((p) => !p.closed);
  if (number !== undefined) {
    const found = open.find((p) => p.number === number);
    if (!found) throw new Error(`Project ${number} is not an open Project linked to this repository.`);
    return found;
  }
  if (open.length > 1) {
    const names = open.map((p) => `${p.number} (${p.title})`).join(', ');
    throw new Error(`Several Projects are linked to this repository: ${names}. Pick one with --project.`);
  }
  return open[0] ?? null;
}

/** The labels to remove and add so that `stage:<stage>` is the issue's only stage label. */
export function stageSwap(labels: string[], stage: Stage): { remove: string[]; add: string | null } {
  const target = `stage:${stage}`;
  return {
    remove: labels.filter((l) => l.startsWith('stage:') && l !== target),
    add: labels.includes(target) ? null : target,
  };
}

/** The stage the issue's labels give it, or null when it has none (a bug record, say). */
export function labelStage(labels: string[]): string | null {
  const stages = labels.filter((l) => l.startsWith('stage:'));
  if (stages.length > 1) throw new Error(`The issue has several stage labels (${stages.join(', ')}); pass --stage.`);
  return stages[0]?.slice('stage:'.length) ?? null;
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The sprint `today` (YYYY-MM-DD) falls in, or for `next` the first one that starts after it. */
export function findSprint(iterations: Iteration[], which: 'current' | 'next', today: string): Iteration | null {
  const sorted = [...iterations].sort((a, b) => a.startDate.localeCompare(b.startDate));
  if (which === 'next') return sorted.find((i) => i.startDate > today) ?? null;
  return sorted.find((i) => i.startDate <= today && today < addDays(i.startDate, i.duration)) ?? null;
}

/** Minutes as hours to two decimals, the unit the Estimate field holds. */
export function hours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

const KINDS = { select: 'single-select', iteration: 'iteration', number: 'number' } as const;

function field<K extends keyof typeof KINDS>(
  project: Project,
  name: string,
  kind: K,
): Extract<ProjectField, { kind: K }> {
  const found = project.fields.find((f) => f.name === name);
  if (found?.kind !== kind) throw new Error(`${project.title} has no ${KINDS[kind]} field named ${name}.`);
  return found as Extract<ProjectField, { kind: K }>;
}

function option(project: Project, name: string, value: string): FieldWrite {
  const select = field(project, name, 'select');
  const found = select.options.find((o) => o.name === value);
  if (!found) {
    const names = select.options.map((o) => o.name).join(', ');
    throw new Error(`${name} on ${project.title} has no option "${value}"; it has ${names}.`);
  }
  return { field: name, fieldId: select.id, value: { singleSelectOptionId: found.id }, shown: value };
}

/**
 * Every field value this run sets, checked against the Project's fields before anything is written.
 * Stage mirrors the stage label, which stays the source of truth. An epic, an issue with sub-issues,
 * takes no sprint: its sub-issues do.
 */
export function planWrites(
  project: Project,
  issue: { labels: string[]; subIssues: number },
  request: BoardRequest,
  today: string,
): FieldWrite[] {
  const writes: FieldWrite[] = [];
  const stage = labelStage(issue.labels);
  if (stage !== null) writes.push(option(project, 'Stage', stage));
  if (request.sprint !== undefined) {
    const sprints = field(project, 'Sprint', 'iteration');
    if (request.sprint === 'none') writes.push({ field: 'Sprint', fieldId: sprints.id, shown: 'none' });
    else {
      if (issue.subIssues > 0) {
        throw new Error('The issue has sub-issues, so it is an epic and takes no sprint; its sub-issues do.');
      }
      const found = findSprint(sprints.iterations, request.sprint, today);
      if (!found) {
        const when = request.sprint === 'current' ? `covers ${today}` : `starts after ${today}`;
        throw new Error(`No sprint on ${project.title} ${when}; add sprints to its Sprint field on github.com.`);
      }
      writes.push({ field: 'Sprint', fieldId: sprints.id, value: { iterationId: found.id }, shown: found.title });
    }
  }
  if (request.estimateMin !== undefined) {
    const estimate = field(project, 'Estimate', 'number');
    const value = hours(request.estimateMin);
    writes.push({ field: 'Estimate', fieldId: estimate.id, value: { number: value }, shown: `${value}h` });
  }
  if (request.priority !== undefined) writes.push(option(project, 'Priority', request.priority));
  return writes;
}
