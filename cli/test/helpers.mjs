import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export function tempDir(prefix = 'rsl-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** Writes files given as { 'relative/path': string | object } under root; objects become JSON. */
export function writeTree(root, files) {
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  }
  return root;
}

export function skill(name, description = `The ${name} skill.`) {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`;
}

/** A small agent-workflow-tooling repository: two local plugins and profiles over them and one external plugin. */
export function sampleRepo(root = tempDir('rsl-repo-')) {
  return writeTree(root, {
    '.claude-plugin/marketplace.json': {
      name: 'agent-workflow-tooling',
      owner: { name: 'Test' },
      plugins: [
        { name: 'workflow', source: './plugins/workflow', description: 'Workflow.' },
        { name: 'frontend', source: './plugins/frontend', description: 'Frontend.' },
      ],
    },
    'plugins/workflow/.claude-plugin/plugin.json': { name: 'workflow', description: 'Workflow.' },
    'plugins/workflow/skills/bugfix/SKILL.md': skill('bugfix'),
    'plugins/workflow/hooks/hooks.json': { hooks: {} },
    'plugins/frontend/.claude-plugin/plugin.json': { name: 'frontend', description: 'Frontend.' },
    'plugins/frontend/skills/frontend-craft/SKILL.md': skill('frontend-craft'),
    'plugins/frontend/.mcp.json': { mcpServers: { browser: { command: 'bash', args: ['-c', 'exec true'] } } },
    'profiles.json': {
      marketplaces: {
        'agent-workflow-tooling': 'Reference-Systems-Lab/agent-workflow-tooling',
        'claude-plugins-official': 'anthropics/claude-plugins-official',
      },
      profiles: {
        base: ['workflow@agent-workflow-tooling', 'context7@claude-plugins-official'],
        storefront: ['@base', 'frontend'],
      },
    },
  });
}

/**
 * An in-memory stand-in for the `claude`, `codex` and (when given `copilot` state) `copilot` CLIs, answering the subcommands rsl uses
 * with the JSON shapes the real tools print. `codex plugin add` writes `enabled = true` to
 * `<codexHome>/config.toml` like the real tool, and `codex plugin list` reads it back.
 * `names` maps a marketplace source (path or owner/repo) to the marketplace name it declares.
 */
export function fakeTools({ codexHome, names, missing = [], fail = [], claude = {}, codex = {}, copilot }) {
  // Copilot CLI is absent unless a test gives it state, so tests of the other tools stay as they were.
  if (copilot === undefined) missing = [...missing, 'copilot'];
  const state = {
    claude: { marketplaces: [...(claude.marketplaces ?? [])], plugins: [...(claude.plugins ?? [])] },
    codex: { marketplaces: [...(codex.marketplaces ?? [])] },
    copilot: { marketplaces: [...(copilot?.marketplaces ?? [])], plugins: [...(copilot?.plugins ?? [])] },
  };
  const calls = [];
  const cwds = {};
  const configPath = join(codexHome, 'config.toml');
  const readConfig = () => (existsSync(configPath) ? readFileSync(configPath, 'utf8') : '');
  const codexPlugins = () =>
    [...readConfig().matchAll(/\[plugins\."([^"]+)"\]\nenabled = (true|false)/g)].map((m) => ({
      pluginId: m[1],
      enabled: m[2] === 'true',
    }));
  for (const id of codex.plugins ?? []) {
    mkdirSync(codexHome, { recursive: true });
    writeFileSync(configPath, `${readConfig()}[plugins."${id.id}"]\nenabled = ${id.enabled}\n`);
  }
  const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
  const run = (cmd, args, options = {}) => {
    calls.push([cmd, ...args].join(' '));
    if (options.cwd) cwds[[cmd, ...args].join(' ')] = options.cwd;
    if (missing.includes(cmd)) return { code: 127, stdout: '', stderr: `${cmd}: not found` };
    if (fail.includes([cmd, ...args].join(' '))) return { code: 1, stdout: '', stderr: 'simulated failure' };
    const a = args.join(' ');
    if (a === '--version') return ok(`${cmd} 1.0.0\n`);
    if (cmd === 'claude') {
      const s = state.claude;
      if (a === 'plugin marketplace list --json') return ok(JSON.stringify(s.marketplaces.map((name) => ({ name }))));
      if (a.startsWith('plugin marketplace add ')) return (s.marketplaces.push(names[args[3]]), ok());
      if (a.startsWith('plugin marketplace update ')) return ok();
      if (a === 'plugin list --json')
        return ok(
          JSON.stringify(
            s.plugins.map((p) =>
              typeof p === 'string' ? { id: p, scope: 'user', enabled: true } : { enabled: true, ...p },
            ),
          ),
        );
      if (a.startsWith('plugin update ')) return ok();
    }
    if (cmd === 'codex') {
      const s = state.codex;
      if (a === 'plugin marketplace list --json')
        return ok(JSON.stringify({ marketplaces: s.marketplaces.map((name) => ({ name })) }));
      if (a.startsWith('plugin marketplace add ')) return (s.marketplaces.push(names[args[3]]), ok());
      if (a === 'plugin list --json') return ok(JSON.stringify({ installed: codexPlugins(), available: [] }));
      if (a.startsWith('plugin add ')) {
        const id = args[2];
        const text = readConfig();
        const header = `[plugins."${id}"]\n`;
        mkdirSync(codexHome, { recursive: true });
        writeFileSync(
          configPath,
          text.includes(header)
            ? text.replace(new RegExp(`(\\[plugins\\."${id}"\\]\\nenabled = )(true|false)`), '$1true')
            : `${text}${header}enabled = true\n`,
        );
        return ok();
      }
    }
    if (cmd === 'copilot') {
      const s = state.copilot;
      if (a === 'plugin marketplace list --json')
        return ok(JSON.stringify(s.marketplaces.map((name) => ({ name, isDefault: false }))));
      if (a.startsWith('plugin marketplace add ')) return (s.marketplaces.push(names[args[3]]), ok());
      if (a.startsWith('plugin marketplace update ')) return ok();
      // Like the real tool, a local marketplace lists every plugin it offers, enabled only once installed.
      if (a === 'plugin list --json') {
        const local = ['workflow', 'frontend'].map((name) => `${name}@agent-workflow-tooling`);
        return ok(
          JSON.stringify(
            [...new Set([...local, ...s.plugins])].map((id) => ({
              name: id.slice(0, id.lastIndexOf('@')),
              marketplace: id.slice(id.lastIndexOf('@') + 1),
              enabled: s.plugins.includes(id),
              source: 'live',
            })),
          ),
        );
      }
    }
    return { code: 2, stdout: '', stderr: `fake ${cmd}: unsupported "${a}"` };
  };
  return { run, calls, cwds, state, configPath };
}
