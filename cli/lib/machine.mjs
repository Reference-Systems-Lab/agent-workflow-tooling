import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { marketplaceOf } from './catalog.mjs';
import { setCodexPlugins } from './project.mjs';

export function codexHome(deps) {
  return deps.env.CODEX_HOME || join(deps.home, '.codex');
}

export function copilotHome(deps) {
  return deps.env.COPILOT_HOME || join(deps.home, '.copilot');
}

export function claudeHome(deps) {
  return deps.env.CLAUDE_CONFIG_DIR || join(deps.home, '.claude');
}

export function tilde(deps, path) {
  return path.startsWith(`${deps.home}/`) ? `~${path.slice(deps.home.length)}` : path;
}

function stamp(deps) {
  return deps.now().toISOString().replace(/[-:]/g, '').slice(0, 15);
}

/**
 * Runs a tool command, failing loudly on a non-zero exit. Copilot CLI merges the working
 * directory's .github/copilot/settings.json into its marketplace list, so its commands run from
 * the home directory and only ever see this machine's setup.
 */
function call(deps, tool, args, options = {}) {
  const result = deps.run(tool, args, tool === 'copilot' ? { cwd: deps.home, ...options } : options);
  if (result.code !== 0) throw new Error(`${tool} ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout;
}

/** The Claude Code, Codex and Copilot CLI commands rsl needs, over each tool's JSON output. */
export const TOOLS = {
  claude: {
    marketplaces: (deps) =>
      JSON.parse(call(deps, 'claude', ['plugin', 'marketplace', 'list', '--json'])).map((m) => m.name),
    plugins: (deps) =>
      JSON.parse(call(deps, 'claude', ['plugin', 'list', '--json'])).map((p) => ({
        id: p.id,
        enabled: p.enabled,
        scope: p.scope,
        projectPath: p.projectPath,
      })),
    addMarketplace: ['plugin', 'marketplace', 'add'],
  },
  codex: {
    marketplaces: (deps) =>
      JSON.parse(call(deps, 'codex', ['plugin', 'marketplace', 'list', '--json'])).marketplaces.map((m) => m.name),
    plugins: (deps) =>
      JSON.parse(call(deps, 'codex', ['plugin', 'list', '--json'])).installed.map((p) => ({
        id: p.pluginId,
        enabled: p.enabled,
      })),
    addMarketplace: ['plugin', 'marketplace', 'add'],
  },
  copilot: {
    marketplaces: (deps) =>
      JSON.parse(call(deps, 'copilot', ['plugin', 'marketplace', 'list', '--json'])).map((m) => m.name),
    // A local marketplace lists all of its plugins as "live", with the ones not installed disabled,
    // so only enabled plugins count as installed.
    plugins: (deps) =>
      JSON.parse(call(deps, 'copilot', ['plugin', 'list', '--json']))
        .filter((p) => p.enabled)
        .map((p) => ({ id: `${p.name}@${p.marketplace}`, enabled: true })),
    addMarketplace: ['plugin', 'marketplace', 'add'],
  },
};

export const TOOL_NAMES = Object.keys(TOOLS);

export function available(deps, tool) {
  return deps.run(tool, ['--version']).code === 0;
}

/** Where a marketplace is added from: this checkout for agent-workflow-tooling, GitHub for the rest. */
function sourceOf(catalog, market) {
  return market === catalog.name ? catalog.repo : catalog.marketplaces[market];
}

function act(deps, lines, dryRun, description, action) {
  if (dryRun) {
    lines.push(`would: ${description}`);
    return;
  }
  action();
  lines.push(description);
}

function toolCommand(deps, lines, dryRun, tool, args, options = {}) {
  act(deps, lines, dryRun, `${tool} ${args.join(' ')}`, () => call(deps, tool, args, options));
}

/** Adds this marketplace, and those `ids` come from, to one tool where it lacks them. */
function addMarketplaces(catalog, deps, lines, dryRun, tool, ids) {
  const t = TOOLS[tool];
  const markets = t.marketplaces(deps);
  for (const market of [catalog.name, ...ids.map(marketplaceOf)].filter((m, i, all) => all.indexOf(m) === i)) {
    if (markets.includes(market)) lines.push(`ok: ${tool} has marketplace ${market}`);
    else toolCommand(deps, lines, dryRun, tool, [...t.addMarketplace, sourceOf(catalog, market)]);
  }
}

/** Adds missing marketplaces and installs missing plugins in Codex, recording each id it installs. */
function provideCodex(catalog, deps, lines, ids, added) {
  addMarketplaces(catalog, deps, lines, false, 'codex', ids);
  const installed = new Set(TOOLS.codex.plugins(deps).map((p) => p.id));
  for (const id of ids) {
    if (installed.has(id)) {
      lines.push(`ok: codex has ${id}`);
      continue;
    }
    toolCommand(deps, lines, false, 'codex', ['plugin', 'add', id]);
    added.push(id);
  }
}

function backup(deps, lines, path) {
  const base = `${path}.bak-${stamp(deps)}`;
  let saved = base;
  for (let n = 2; exists(saved); n++) saved = `${base}-${n}`;
  renameSync(path, saved);
  lines.push(`backed up ${tilde(deps, path)} → ${tilde(deps, saved)}`);
}

function exists(path) {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function replacing(path) {
  return exists(path) ? ' (backing up the existing file)' : '';
}

function link(deps, lines, dryRun, path, target) {
  if (exists(path) && lstatSync(path).isSymbolicLink() && readlinkSync(path) === target) {
    lines.push(`ok: ${tilde(deps, path)}`);
    return;
  }
  act(deps, lines, dryRun, `link ${tilde(deps, path)} → ${target}${replacing(path)}`, () => {
    mkdirSync(dirname(path), { recursive: true });
    if (exists(path)) backup(deps, lines, path);
    symlinkSync(target, path);
  });
}

/** Runs steps that report into `lines`, attaching what ran to any error so the caller can show it. */
function reporting(body) {
  const lines = [];
  try {
    body(lines);
    return lines;
  } catch (error) {
    error.lines = lines;
    throw error;
  }
}

/**
 * Sets up this machine: each tool knows this checkout as the marketplace, and the CLIs are linked.
 * It enables no plugin anywhere; `init` does that for one project at a time. Safe to run again.
 */
export function install(catalog, deps, { dryRun = false } = {}) {
  return reporting((lines) => installSteps(catalog, deps, dryRun, lines));
}

function installSteps(catalog, deps, dryRun, lines) {
  for (const tool of TOOL_NAMES) {
    if (!available(deps, tool)) lines.push(`${tool}: not installed, skipped`);
    else addMarketplaces(catalog, deps, lines, dryRun, tool, []);
  }

  const bin = join(deps.home, '.local/bin');
  link(deps, lines, dryRun, join(bin, 'rsl'), join(catalog.repo, 'cli/rsl.mjs'));
  link(deps, lines, dryRun, join(bin, 'worklog'), join(catalog.repo, 'plugins/workflow/dist/cli.js'));
}

function setCodexUserPlugins(deps, lines, ids, enabled) {
  const config = join(codexHome(deps), 'config.toml');
  const text = existsSync(config) ? readFileSync(config, 'utf8') : '';
  const next = setCodexPlugins(text, ids, enabled);
  if (next === text) return;
  if (existsSync(config)) backup(deps, lines, config);
  writeFileSync(config, next);
}

/**
 * Codex has no project-scoped install, so a project's plugins are installed for the user and
 * switched off there, leaving them on only in projects that turn them on.
 */
export function ensureCodexPlugins(catalog, deps, ids) {
  return reporting((lines) => {
    if (available(deps, 'codex')) codexForProject(catalog, deps, ids, lines);
    else lines.push('codex: not installed, skipped');
  });
}

function codexForProject(catalog, deps, ids, lines) {
  const added = [];
  try {
    provideCodex(catalog, deps, lines, ids, added);
  } finally {
    if (added.length > 0) {
      setCodexUserPlugins(deps, lines, added, false);
      lines.push(`codex: ${added.join(', ')} enabled only in projects that turn them on`);
    }
  }
}

/**
 * Picks up committed changes to agent-workflow-tooling plugins. Claude Code caches each install by commit,
 * so every install is updated in its own scope (project installs from their project). Codex copies
 * plugins, and re-adding one switches it on, so its previous switch is restored.
 */
export function update(catalog, deps) {
  return reporting((lines) => {
    const ours = (p) => marketplaceOf(p.id) === catalog.name;
    const ready = (tool) => {
      if (!available(deps, tool)) return false;
      if (TOOLS[tool].marketplaces(deps).includes(catalog.name)) return true;
      lines.push(`${tool}: ${catalog.name} marketplace not added; run rsl install`);
      return false;
    };
    if (ready('claude')) {
      toolCommand(deps, lines, false, 'claude', ['plugin', 'marketplace', 'update', catalog.name]);
      for (const p of TOOLS.claude.plugins(deps).filter(ours)) {
        const cwd = p.scope === 'project' || p.scope === 'local' ? { cwd: p.projectPath } : {};
        toolCommand(deps, lines, false, 'claude', ['plugin', 'update', p.id, '--scope', p.scope], cwd);
      }
    }
    if (ready('codex')) {
      const plugins = TOOLS.codex.plugins(deps).filter(ours);
      const off = plugins.filter((p) => !p.enabled).map((p) => p.id);
      try {
        for (const p of plugins) toolCommand(deps, lines, false, 'codex', ['plugin', 'add', p.id]);
      } finally {
        if (off.length > 0) setCodexUserPlugins(deps, lines, off, false);
      }
    }
    // Copilot loads a local marketplace's plugins live, so only the catalog needs refreshing.
    if (ready('copilot')) toolCommand(deps, lines, false, 'copilot', ['plugin', 'marketplace', 'update', catalog.name]);
  });
}
