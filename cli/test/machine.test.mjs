import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { loadCatalog } from '../lib/catalog.mjs';
import { install, update, ensureCodexPlugins } from '../lib/machine.mjs';
import { fakeTools, sampleRepo, tempDir } from './helpers.mjs';

function machine(options = {}) {
  const repo = sampleRepo();
  const home = tempDir('rsl-home-');
  const codexHome = join(home, '.codex');
  const names = {
    [repo]: 'agent-workflow-tooling',
    'anthropics/claude-plugins-official': 'claude-plugins-official',
  };
  const tools = fakeTools({ codexHome, names, ...options });
  const deps = { home, env: {}, run: tools.run, now: () => new Date('2026-10-02T10:00:00Z') };
  return { repo, home, codexHome, tools, deps, catalog: loadCatalog(repo) };
}

const writes = (calls) => calls.filter((c) => !c.endsWith('--json') && !c.endsWith('--version'));

test('install adds this marketplace to Claude Code and Codex and installs no plugins', () => {
  const { repo, tools, deps, catalog } = machine();
  install(catalog, deps);
  assert.deepEqual(writes(tools.calls), [
    `claude plugin marketplace add ${repo}`,
    `codex plugin marketplace add ${repo}`,
  ]);
});

test('install links the rsl and worklog CLIs and leaves global instructions alone', () => {
  const { repo, home, deps, catalog } = machine();
  install(catalog, deps);
  assert.equal(readlinkSync(join(home, '.local/bin/rsl')), join(repo, 'cli/rsl.mjs'));
  assert.equal(readlinkSync(join(home, '.local/bin/worklog')), join(repo, 'plugins/workflow/dist/cli.js'));
  assert.equal(existsSync(join(home, '.claude')), false);
  assert.equal(existsSync(join(home, '.codex/AGENTS.md')), false);
  assert.equal(existsSync(join(home, '.config')), false);
});

test('install skips a tool that is not installed', () => {
  const { tools, deps, catalog } = machine({ missing: ['codex'] });
  const lines = install(catalog, deps);
  assert.ok(lines.includes('codex: not installed, skipped'), lines.join('\n'));
  assert.ok(lines.includes('copilot: not installed, skipped'), lines.join('\n'));
  assert.equal(writes(tools.calls).filter((c) => c.startsWith('codex')).length, 0);
});

test('install backs up files it replaces and leaves its own earlier work alone', () => {
  const { home, tools, deps, catalog } = machine({ copilot: {} });
  const worklog = join(home, '.local/bin/worklog');
  mkdirSync(join(home, '.local/bin'), { recursive: true });
  symlinkSync('/old/worklog/cli.js', worklog);
  install(catalog, deps);
  assert.equal(readlinkSync(`${worklog}.bak-20261002T100000`), '/old/worklog/cli.js');
  const before = tools.calls.length;
  const again = install(catalog, deps);
  assert.deepEqual(writes(tools.calls.slice(before)), [], 'no tool changes on a second run');
  assert.deepEqual(
    again.filter((l) => !l.startsWith('ok')),
    [],
  );
});

test('backups made in the same second never overwrite each other', () => {
  const { home, deps, catalog } = machine();
  const rsl = join(home, '.local/bin/rsl');
  mkdirSync(join(home, '.local/bin'), { recursive: true });
  writeFileSync(rsl, '# first\n');
  install(catalog, deps);
  rmSync(rsl);
  writeFileSync(rsl, '# second\n');
  install(catalog, deps);
  assert.equal(readFileSync(`${rsl}.bak-20261002T100000`, 'utf8'), '# first\n');
  assert.equal(readFileSync(`${rsl}.bak-20261002T100000-2`, 'utf8'), '# second\n');
});

test('install --dry-run reports what it would do without changing anything', () => {
  const { repo, home, tools, deps, catalog } = machine();
  const lines = install(catalog, deps, { dryRun: true });
  assert.deepEqual(writes(tools.calls), []);
  assert.equal(existsSync(join(home, '.local')), false);
  assert.ok(lines.includes(`would: claude plugin marketplace add ${repo}`), lines.join('\n'));
  assert.ok(
    lines.some((l) => l.startsWith('would: link ~/.local/bin/worklog')),
    lines.join('\n'),
  );
  assert.equal(lines.filter((l) => l.includes('plugin install') || l.includes('plugin add')).length, 0);
});

test('install --dry-run says which existing files it would back up', () => {
  const { home, deps, catalog } = machine();
  mkdirSync(join(home, '.local/bin'), { recursive: true });
  writeFileSync(join(home, '.local/bin/rsl'), '# old\n');
  const lines = install(catalog, deps, { dryRun: true });
  assert.ok(
    lines.includes(
      `would: link ~/.local/bin/rsl → ${join(catalog.repo, 'cli/rsl.mjs')} (backing up the existing file)`,
    ),
    lines.join('\n'),
  );
});

test('update refreshes agent-workflow-tooling plugins in both tools and keeps Codex plugins disabled where they were', () => {
  const { repo, tools, deps, catalog, codexHome } = machine({
    claude: {
      marketplaces: ['agent-workflow-tooling'],
      plugins: ['workflow@agent-workflow-tooling', 'context7@claude-plugins-official'],
    },
    codex: {
      marketplaces: ['agent-workflow-tooling'],
      plugins: [
        { id: 'workflow@agent-workflow-tooling', enabled: true },
        { id: 'frontend@agent-workflow-tooling', enabled: false },
      ],
    },
  });
  update(catalog, deps);
  assert.deepEqual(writes(tools.calls), [
    'claude plugin marketplace update agent-workflow-tooling',
    'claude plugin update workflow@agent-workflow-tooling --scope user',
    'codex plugin add workflow@agent-workflow-tooling',
    'codex plugin add frontend@agent-workflow-tooling',
  ]);
  const config = readFileSync(join(codexHome, 'config.toml'), 'utf8');
  assert.match(config, /\[plugins\."workflow@agent-workflow-tooling"\]\nenabled = true/);
  assert.match(config, /\[plugins\."frontend@agent-workflow-tooling"\]\nenabled = false/);
  assert.ok(repo);
});

test('update refreshes Claude Code plugins in every scope, from the project for project installs', () => {
  const { tools, deps, catalog } = machine({
    claude: {
      marketplaces: ['agent-workflow-tooling'],
      plugins: [
        'workflow@agent-workflow-tooling',
        { id: 'frontend@agent-workflow-tooling', scope: 'project', projectPath: '/work/app' },
        { id: 'context7@claude-plugins-official', scope: 'project', projectPath: '/work/app' },
      ],
    },
    missing: ['codex'],
  });
  update(catalog, deps);
  assert.deepEqual(writes(tools.calls), [
    'claude plugin marketplace update agent-workflow-tooling',
    'claude plugin update workflow@agent-workflow-tooling --scope user',
    'claude plugin update frontend@agent-workflow-tooling --scope project',
  ]);
  assert.equal(tools.cwds['claude plugin update frontend@agent-workflow-tooling --scope project'], '/work/app');
});

test('ensureCodexPlugins installs missing plugins and leaves every one it installs off outside projects', () => {
  const { tools, deps, catalog, codexHome } = machine({
    codex: {
      marketplaces: ['agent-workflow-tooling', 'claude-plugins-official'],
      plugins: [{ id: 'workflow@agent-workflow-tooling', enabled: true }],
    },
  });
  ensureCodexPlugins(catalog, deps, [
    'workflow@agent-workflow-tooling',
    'frontend@agent-workflow-tooling',
    'context7@claude-plugins-official',
  ]);
  assert.deepEqual(writes(tools.calls), [
    'codex plugin add frontend@agent-workflow-tooling',
    'codex plugin add context7@claude-plugins-official',
  ]);
  const config = readFileSync(join(codexHome, 'config.toml'), 'utf8');
  assert.match(config, /\[plugins\."frontend@agent-workflow-tooling"\]\nenabled = false/);
  assert.match(config, /\[plugins\."context7@claude-plugins-official"\]\nenabled = false/);
  assert.match(
    config,
    /\[plugins\."workflow@agent-workflow-tooling"\]\nenabled = true/,
    'one it did not install is left as it was',
  );
  assert.equal(lstatSync(join(codexHome, 'config.toml')).isFile(), true);
});

test('rsl backs up the Codex user config before switching plugins off in it', () => {
  const { deps, catalog, codexHome } = machine({
    codex: { marketplaces: ['agent-workflow-tooling', 'claude-plugins-official'] },
  });
  ensureCodexPlugins(catalog, deps, ['frontend@agent-workflow-tooling']);
  const saved = readFileSync(join(codexHome, 'config.toml.bak-20261002T100000'), 'utf8');
  assert.match(saved, /\[plugins\."frontend@agent-workflow-tooling"\]\nenabled = true/);
  assert.match(
    readFileSync(join(codexHome, 'config.toml'), 'utf8'),
    /\[plugins\."frontend@agent-workflow-tooling"\]\nenabled = false/,
  );
});

test('a failed re-add during update still leaves switched-off Codex plugins off', () => {
  const { deps, catalog, codexHome } = machine({
    fail: ['codex plugin add frontend@agent-workflow-tooling'],
    missing: ['claude'],
    codex: {
      marketplaces: ['agent-workflow-tooling'],
      plugins: [
        { id: 'workflow@agent-workflow-tooling', enabled: false },
        { id: 'frontend@agent-workflow-tooling', enabled: false },
      ],
    },
  });
  assert.throws(() => update(catalog, deps), /frontend@agent-workflow-tooling failed/);
  const config = readFileSync(join(codexHome, 'config.toml'), 'utf8');
  assert.match(config, /\[plugins\."workflow@agent-workflow-tooling"\]\nenabled = false/);
  assert.match(config, /\[plugins\."frontend@agent-workflow-tooling"\]\nenabled = false/);
});

test('a failed install during init leaves the plugins it did install off outside projects', () => {
  const { deps, catalog, codexHome } = machine({
    fail: ['codex plugin add context7@claude-plugins-official'],
    codex: { marketplaces: ['agent-workflow-tooling', 'claude-plugins-official'] },
  });
  assert.throws(
    () => ensureCodexPlugins(catalog, deps, ['frontend@agent-workflow-tooling', 'context7@claude-plugins-official']),
    /failed/,
  );
  assert.match(
    readFileSync(join(codexHome, 'config.toml'), 'utf8'),
    /\[plugins\."frontend@agent-workflow-tooling"\]\nenabled = false/,
  );
});

test('install adds the marketplace to Copilot CLI too, without plugins or instructions', () => {
  const { repo, home, tools, deps, catalog } = machine({ copilot: {} });
  install(catalog, deps);
  assert.deepEqual(
    writes(tools.calls).filter((c) => c.startsWith('copilot')),
    [`copilot plugin marketplace add ${repo}`],
  );
  assert.equal(existsSync(join(home, '.copilot')), false);
});

test('update refreshes the marketplace catalog in Copilot CLI', () => {
  const { tools, deps, catalog } = machine({ copilot: { marketplaces: ['agent-workflow-tooling'] } });
  update(catalog, deps);
  assert.ok(tools.calls.includes('copilot plugin marketplace update agent-workflow-tooling'), tools.calls.join('\n'));
});

test("Copilot commands run from the home directory so a project's .github/copilot/settings.json cannot leak in", () => {
  const { home, tools, deps, catalog } = machine({ copilot: {} });
  install(catalog, deps);
  update(catalog, deps);
  const copilot = Object.entries(tools.cwds).filter(([c]) => c.startsWith('copilot'));
  assert.ok(copilot.length >= 3, 'install and update both ran Copilot commands');
  assert.deepEqual([...new Set(copilot.map(([, cwd]) => cwd))], [home]);
  assert.equal(tools.cwds['copilot plugin marketplace list --json'], home);
});
