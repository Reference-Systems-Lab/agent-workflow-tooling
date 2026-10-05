import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { main } from '../lib/cli.mjs';
import { fakeTools, sampleRepo, tempDir, writeTree } from './helpers.mjs';

function setup(options = {}) {
  const repo = sampleRepo();
  const home = tempDir('rsl-home-');
  const project = tempDir('rsl-project-');
  const tools = fakeTools({
    codexHome: join(home, '.codex'),
    names: { [repo]: 'agent-workflow-tooling', 'anthropics/claude-plugins-official': 'claude-plugins-official' },
    ...options,
  });
  let out = '';
  let err = '';
  const deps = {
    repo,
    home,
    cwd: project,
    env: {},
    run: tools.run,
    now: () => new Date('2026-10-02T10:00:00Z'),
    stdout: (s) => (out += s),
    stderr: (s) => (err += s),
  };
  const run = async (...argv) => {
    out = '';
    err = '';
    const code = await main(argv, deps);
    return { code, out, err };
  };
  return { repo, home, project, tools, run };
}

test('init sets a project up for Claude Code and Codex from a profile', async () => {
  const { project, home, run } = setup();
  const result = await run('init', 'storefront');
  assert.equal(result.code, 0, result.err);
  const settings = JSON.parse(readFileSync(join(project, '.claude/settings.json'), 'utf8'));
  assert.deepEqual(Object.keys(settings.enabledPlugins), [
    'workflow@agent-workflow-tooling',
    'context7@claude-plugins-official',
    'frontend@agent-workflow-tooling',
  ]);
  assert.deepEqual(settings.extraKnownMarketplaces['agent-workflow-tooling'], {
    source: { source: 'github', repo: 'Reference-Systems-Lab/agent-workflow-tooling' },
  });
  const codex = readFileSync(join(project, '.codex/config.toml'), 'utf8');
  assert.match(codex, /\[plugins\."frontend@agent-workflow-tooling"\]\nenabled = true/);
  assert.equal(readFileSync(join(project, 'CLAUDE.md'), 'utf8'), '@AGENTS.md\n');
  const user = readFileSync(join(home, '.codex/config.toml'), 'utf8');
  assert.match(user, /\[plugins\."frontend@agent-workflow-tooling"\]\nenabled = false/);
  assert.match(
    user,
    /\[plugins\."workflow@agent-workflow-tooling"\]\nenabled = false/,
    'base is off outside projects too',
  );
  assert.match(result.out, /\.claude\/settings\.json/);
});

test("init adds the files a plugin scaffolds, only for plugins it enables, and keeps the project's own", async () => {
  const { repo, project, run } = setup();
  writeTree(repo, {
    'plugins/workflow/scaffold/.github/ISSUE_TEMPLATE/feature.yml': 'name: Feature\n',
    'plugins/workflow/scaffold/.gitignore': '.agent/\n',
    'plugins/frontend/scaffold/frontend.md': 'not wanted\n',
  });
  writeTree(project, { '.gitignore': 'node_modules\n' });
  const result = await run('init', 'workflow', '--no-codex');
  assert.equal(result.code, 0, result.err);
  assert.equal(readFileSync(join(project, '.github/ISSUE_TEMPLATE/feature.yml'), 'utf8'), 'name: Feature\n');
  assert.equal(readFileSync(join(project, '.gitignore'), 'utf8'), 'node_modules\n\n.agent/\n');
  assert.equal(existsSync(join(project, 'frontend.md')), false);
  assert.match(result.out, /wrote \.github\/ISSUE_TEMPLATE\/feature\.yml/);
  assert.match((await run('init', 'workflow', '--no-codex')).out, /already set up/);
});

test('init also enables the plugins for Copilot CLI in the repository settings', async () => {
  const { project, run } = setup();
  const result = await run('init', 'storefront', '--no-codex');
  assert.equal(result.code, 0, result.err);
  const settings = JSON.parse(readFileSync(join(project, '.github/copilot/settings.json'), 'utf8'));
  assert.deepEqual(Object.keys(settings.enabledPlugins), [
    'workflow@agent-workflow-tooling',
    'frontend@agent-workflow-tooling',
  ]);
  assert.deepEqual(Object.keys(settings.extraKnownMarketplaces), ['agent-workflow-tooling']);
  assert.deepEqual(settings.extraKnownMarketplaces['agent-workflow-tooling'], {
    source: { source: 'github', repo: 'Reference-Systems-Lab/agent-workflow-tooling' },
  });
  assert.match(result.out, /\.github\/copilot\/settings\.json/);
});

test('init twice changes nothing the second time', async () => {
  const { project, run } = setup();
  await run('init', 'storefront', '--no-codex');
  const before =
    readFileSync(join(project, '.claude/settings.json'), 'utf8') +
    readFileSync(join(project, '.codex/config.toml'), 'utf8');
  const again = await run('init', 'storefront', '--no-codex');
  const after =
    readFileSync(join(project, '.claude/settings.json'), 'utf8') +
    readFileSync(join(project, '.codex/config.toml'), 'utf8');
  assert.equal(after, before);
  assert.match(again.out, /already set up/);
});

test('init takes a --dir and rejects unknown names without writing anything', async () => {
  const { run } = setup();
  const target = tempDir('rsl-other-');
  assert.equal((await run('init', 'workflow', '--dir', target, '--no-codex')).code, 0);
  assert.ok(readFileSync(join(target, '.claude/settings.json'), 'utf8').includes('workflow@agent-workflow-tooling'));
  const bad = await run('init', 'nope', '--dir', tempDir());
  assert.equal(bad.code, 1);
  assert.match(bad.err, /Unknown profile or plugin "nope"/);
  assert.equal((await run('init')).code, 1);
});

test('list shows profiles and what each plugin provides', async () => {
  const { run } = setup();
  const { code, out } = await run('list');
  assert.equal(code, 0);
  assert.match(
    out,
    /storefront: workflow@agent-workflow-tooling, context7@claude-plugins-official, frontend@agent-workflow-tooling/,
  );
  assert.match(out, /frontend\s+skills: frontend-craft; mcp: browser/);
});

test('validate and doctor exit non-zero when they find problems', async () => {
  const { repo, run } = setup();
  assert.deepEqual(await run('validate'), { code: 0, out: 'agent-workflow-tooling: valid\n', err: '' });
  writeTree(repo, { 'plugins/workflow/skills/bugfix/SKILL.md': '# none\n' });
  const invalid = await run('validate');
  assert.equal(invalid.code, 1);
  assert.match(invalid.out, /plugins\/workflow\/skills\/bugfix\/SKILL.md: no frontmatter/);
  const doctor = await run('doctor');
  assert.equal(doctor.code, 1);
  assert.match(doctor.out, /✖ claude: agent-workflow-tooling marketplace not added/);
});

test('install --dry-run and unknown commands', async () => {
  const { repo, run, tools } = setup();
  const dry = await run('install', '--dry-run');
  assert.equal(dry.code, 0);
  assert.ok(dry.out.includes(`would: claude plugin marketplace add ${repo}`), dry.out);
  assert.doesNotMatch(dry.out, /plugin install/);
  assert.ok(tools.calls.every((c) => c.endsWith('--json') || c.endsWith('--version')));
  const unknown = await run('frobnicate');
  assert.equal(unknown.code, 1);
  assert.match(unknown.err, /Usage: rsl/);
  assert.match((await run('help')).out, /Usage: rsl/);
});

test('init writes nothing when a project file cannot be edited safely', async () => {
  const { project, run } = setup();
  writeTree(project, { '.codex/config.toml': '[plugins]\n"workflow@agent-workflow-tooling".enabled = false\n' });
  const result = await run('init', 'base', '--no-codex');
  assert.equal(result.code, 1);
  assert.match(result.err, /by hand/);
  assert.equal(existsSync(join(project, '.claude/settings.json')), false);
  assert.equal(existsSync(join(project, 'AGENTS.md')), false);
});

test('init puts back the files it wrote when a later project file fails', async () => {
  const { project, run } = setup();
  const settings = '{"permissions":{"allow":["Bash(ls)"]}}\n';
  writeTree(project, { '.claude/settings.json': settings });
  symlinkSync(join(project, 'missing/CLAUDE.md'), join(project, 'CLAUDE.md'));
  const result = await run('init', 'base', '--no-codex');
  assert.equal(result.code, 1);
  assert.equal(readFileSync(join(project, '.claude/settings.json'), 'utf8'), settings);
  assert.equal(existsSync(join(project, '.codex/config.toml')), false);
  assert.equal(existsSync(join(project, 'AGENTS.md')), false);
});

test('unknown options and stray arguments stop a command before it changes anything', async () => {
  const { home, project, tools, run } = setup();
  for (const argv of [
    ['install', '--dryrun'],
    ['install', '-n'],
    ['install', 'now'],
    ['update', '--all'],
    ['init', 'storefront', '--dry-run'],
    ['init', 'workflow', '--dir'],
    ['init', 'workflow', '--dir', '--no-codex'],
  ]) {
    const result = await run(...argv);
    assert.equal(result.code, 1, argv.join(' '));
    assert.match(result.err, /Usage: rsl/, argv.join(' '));
  }
  assert.deepEqual(
    tools.calls.filter((c) => !c.endsWith('--json') && !c.endsWith('--version')),
    [],
  );
  assert.equal(existsSync(join(home, '.claude')), false);
  assert.equal(existsSync(join(project, '.claude')), false);
});

test('init accepts --dir=<path>', async () => {
  const { run } = setup();
  const target = tempDir('rsl-eq-');
  assert.equal((await run('init', 'workflow', `--dir=${target}`, '--no-codex')).code, 0);
  assert.ok(existsSync(join(target, '.claude/settings.json')));
});

test('a failure partway through install still reports the steps that ran', async () => {
  const { repo, run } = setup({ fail: ['codex plugin marketplace list --json'] });
  const result = await run('install');
  assert.equal(result.code, 1);
  assert.ok(result.out.includes(`claude plugin marketplace add ${repo}`), result.out);
  assert.match(result.err, /codex plugin marketplace list --json failed/);
});

test('doctor reports a tool it cannot query and carries on with the other checks', async () => {
  const { run } = setup({
    fail: ['codex plugin marketplace list --json'],
    claude: { marketplaces: ['agent-workflow-tooling'] },
  });
  const result = await run('doctor');
  assert.equal(result.code, 1);
  assert.match(result.out, /✖ codex: .*failed/);
  assert.match(result.out, /✔ claude: agent-workflow-tooling marketplace added/);
});

test('update skips a tool that does not have the agent-workflow-tooling marketplace', async () => {
  const { run, tools } = setup({
    codex: {
      marketplaces: ['agent-workflow-tooling'],
      plugins: [{ id: 'workflow@agent-workflow-tooling', enabled: true }],
    },
  });
  const result = await run('update');
  assert.equal(result.code, 0, result.err);
  assert.match(result.out, /claude: agent-workflow-tooling marketplace not added; run rsl install/);
  assert.ok(tools.calls.includes('codex plugin add workflow@agent-workflow-tooling'));
});
