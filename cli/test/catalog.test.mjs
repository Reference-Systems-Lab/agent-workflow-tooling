import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { loadCatalog, resolve, pluginContents } from '../lib/catalog.mjs';
import { sampleRepo, writeTree } from './helpers.mjs';

test('loadCatalog reads the marketplace plugins, profiles and marketplace sources', () => {
  const repo = sampleRepo();
  const catalog = loadCatalog(repo);
  assert.equal(catalog.name, 'agent-workflow-tooling');
  assert.deepEqual(
    catalog.plugins.map((p) => [p.name, p.dir]),
    [
      ['workflow', join(repo, 'plugins/workflow')],
      ['frontend', join(repo, 'plugins/frontend')],
    ],
  );
  assert.equal(catalog.marketplaces['claude-plugins-official'], 'anthropics/claude-plugins-official');
});

test('resolve expands profiles, profile references and bare local plugin names, in order, once each', () => {
  const catalog = loadCatalog(sampleRepo());
  assert.deepEqual(resolve(catalog, ['storefront']), [
    'workflow@agent-workflow-tooling',
    'context7@claude-plugins-official',
    'frontend@agent-workflow-tooling',
  ]);
  assert.deepEqual(resolve(catalog, ['frontend', 'base', 'workflow']), [
    'frontend@agent-workflow-tooling',
    'workflow@agent-workflow-tooling',
    'context7@claude-plugins-official',
  ]);
});

test('resolve rejects unknown names, unknown marketplaces and profile cycles', () => {
  const catalog = loadCatalog(sampleRepo());
  assert.throws(() => resolve(catalog, ['nope']), /Unknown profile or plugin "nope"/);
  assert.throws(() => resolve(catalog, ['x@elsewhere']), /Unknown marketplace "elsewhere"/);
  assert.throws(
    () => resolve(catalog, ['missing@agent-workflow-tooling']),
    /"missing" is not in the agent-workflow-tooling marketplace/,
  );
  const cyclic = { ...catalog, profiles: { a: ['@b'], b: ['@a'] } };
  assert.throws(() => resolve(cyclic, ['a']), /Profile cycle: a → b → a/);
});

test('pluginContents lists skills, agents, hook events and MCP servers', () => {
  const repo = sampleRepo();
  writeTree(repo, {
    'plugins/workflow/agents/reviewer.md': '---\nname: reviewer\n---\n',
    'plugins/workflow/hooks/hooks.json': { hooks: { Stop: [], UserPromptSubmit: [] } },
  });
  assert.deepEqual(pluginContents(join(repo, 'plugins/workflow')), {
    skills: ['bugfix'],
    agents: ['reviewer'],
    hooks: ['Stop', 'UserPromptSubmit'],
    mcp: [],
  });
  assert.deepEqual(pluginContents(join(repo, 'plugins/frontend')), {
    skills: ['frontend-craft'],
    agents: [],
    hooks: [],
    mcp: ['browser'],
  });
});
