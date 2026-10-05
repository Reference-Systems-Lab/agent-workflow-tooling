import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { loadCatalog } from '../lib/catalog.mjs';
import { doctor } from '../lib/doctor.mjs';
import { fakeTools, sampleRepo, skill, tempDir, writeTree } from './helpers.mjs';

/** A machine where everything rsl manages is in order. */
function healthy(options = {}) {
  const repo = sampleRepo();
  const home = tempDir('rsl-home-');
  const tools = fakeTools({
    codexHome: join(home, '.codex'),
    names: {},
    claude: { marketplaces: ['agent-workflow-tooling'], plugins: ['workflow@agent-workflow-tooling'] },
    codex: {
      marketplaces: ['agent-workflow-tooling'],
      plugins: [{ id: 'workflow@agent-workflow-tooling', enabled: true }],
    },
    ...options,
  });
  const deps = { home, env: {}, run: tools.run, now: () => new Date() };
  return { repo, home, deps, catalog: loadCatalog(repo) };
}

const problems = (findings) => findings.filter((f) => !f.ok).map((f) => f.message);

test('a healthy machine has no problems', () => {
  const { deps, catalog } = healthy();
  assert.deepEqual(problems(doctor(catalog, deps)), []);
});

test('doctor reports a tool without the agent-workflow-tooling marketplace', () => {
  const { deps, catalog } = healthy({ codex: { marketplaces: [], plugins: [] } });
  assert.deepEqual(problems(doctor(catalog, deps)), [
    'codex: agent-workflow-tooling marketplace not added; run rsl install',
  ]);
});

test('doctor reports broken links where skills and CLIs are installed', () => {
  const { home, deps, catalog } = healthy();
  mkdirSync(join(home, '.agents/skills'), { recursive: true });
  symlinkSync('/nowhere/brd-plan', join(home, '.agents/skills/brd-plan'));
  mkdirSync(join(home, '.local/bin'), { recursive: true });
  symlinkSync('/nowhere/cli.js', join(home, '.local/bin/worklog'));
  assert.deepEqual(problems(doctor(catalog, deps)), [
    'broken link ~/.agents/skills/brd-plan → /nowhere/brd-plan',
    'broken link ~/.local/bin/worklog → /nowhere/cli.js',
  ]);
});

test('doctor reports a skill one tool would load twice', () => {
  const { home, deps, catalog } = healthy();
  writeTree(home, {
    '.claude/skills/bugfix/SKILL.md': skill('bugfix'),
    '.agents/skills/frontend-craft/SKILL.md': skill('frontend-craft'),
    '.claude/skills/frontend-craft/SKILL.md': skill('frontend-craft'),
  });
  assert.deepEqual(problems(doctor(catalog, deps)), [
    'claude loads skill "bugfix" twice: ~/.claude/skills/bugfix, agent-workflow-tooling workflow plugin',
  ]);
});

test('doctor reports a missing workflow build but not file times, which a checkout resets', () => {
  const { repo, deps, catalog } = healthy();
  writeTree(repo, { 'plugins/workflow/src/cli.ts': '' });
  assert.deepEqual(problems(doctor(catalog, deps)), [
    'plugins/workflow/dist/cli.js is missing; run npm run build in plugins/workflow',
  ]);
  writeTree(repo, { 'plugins/workflow/dist/cli.js': '' });
  utimesSync(join(repo, 'plugins/workflow/dist/cli.js'), new Date('2026-01-01'), new Date('2026-01-01'));
  assert.deepEqual(problems(doctor(catalog, deps)), []);
});

test('doctor checks Copilot CLI when it is installed', () => {
  const missing = healthy({ copilot: { marketplaces: [], plugins: [] } });
  assert.deepEqual(problems(doctor(missing.catalog, missing.deps)), [
    'copilot: agent-workflow-tooling marketplace not added; run rsl install',
  ]);
  const ok = healthy({
    copilot: { marketplaces: ['agent-workflow-tooling'], plugins: ['workflow@agent-workflow-tooling'] },
  });
  assert.deepEqual(problems(doctor(ok.catalog, ok.deps)), []);
});

test('doctor reports a skill Copilot CLI would load twice', () => {
  const { home, deps, catalog } = healthy({
    copilot: { marketplaces: ['agent-workflow-tooling'], plugins: ['workflow@agent-workflow-tooling'] },
  });
  writeTree(home, { '.copilot/skills/bugfix/SKILL.md': skill('bugfix') });
  assert.deepEqual(problems(doctor(catalog, deps)), [
    'copilot loads skill "bugfix" twice: ~/.copilot/skills/bugfix, agent-workflow-tooling workflow plugin',
  ]);
});
