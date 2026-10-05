import { existsSync, lstatSync, readdirSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { marketplaceOf, pluginContents } from './catalog.mjs';
import { available, claudeHome, codexHome, copilotHome, TOOL_NAMES, tilde, TOOLS } from './machine.mjs';

function children(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => !n.startsWith('.'))
    .sort()
    .map((n) => join(dir, n));
}

function brokenLinks(deps, finding) {
  const dirs = [join(claudeHome(deps), 'skills'), join(deps.home, '.agents/skills'), join(deps.home, '.local/bin')];
  for (const path of dirs.flatMap(children)) {
    if (lstatSync(path).isSymbolicLink() && !existsSync(path)) {
      finding(false, `broken link ${tilde(deps, path)} → ${readlinkSync(path)}`);
    }
  }
}

/** Skill folders directly under `dir`, plus the skills of plugins symlinked or copied there. */
function skillsIn(deps, dir) {
  const found = [];
  for (const path of children(dir)) {
    if (existsSync(join(path, 'SKILL.md'))) found.push([path.split('/').at(-1), tilde(deps, path)]);
    else if (existsSync(join(path, '.claude-plugin/plugin.json'))) {
      for (const name of pluginContents(path).skills) found.push([name, tilde(deps, join(path, 'skills', name))]);
    }
  }
  return found;
}

function duplicateSkills(catalog, deps, installed, finding) {
  const seen = {
    claude: skillsIn(deps, join(claudeHome(deps), 'skills')),
    codex: [...skillsIn(deps, join(deps.home, '.agents/skills')), ...skillsIn(deps, join(codexHome(deps), 'skills'))],
    copilot: skillsIn(deps, join(copilotHome(deps), 'skills')),
  };
  for (const [tool, ids] of Object.entries(installed)) {
    for (const id of ids.filter((i) => marketplaceOf(i) === catalog.name)) {
      const plugin = catalog.plugins.find((p) => `${p.name}@${catalog.name}` === id);
      if (!plugin?.dir) continue;
      for (const name of pluginContents(plugin.dir).skills)
        seen[tool].push([name, `${catalog.name} ${plugin.name} plugin`]);
    }
  }
  for (const [tool, skills] of Object.entries(seen)) {
    const names = [...new Set(skills.map(([n]) => n))].sort();
    for (const name of names) {
      const where = skills.filter(([n]) => n === name).map(([, w]) => w);
      if (where.length > 1) finding(false, `${tool} loads skill "${name}" twice: ${where.join(', ')}`);
    }
  }
}

/**
 * The workflow hooks and worklog run its committed build. Whether that build matches src/ is a
 * content check (npm run check:dist, run in CI); file times are no guide after a clone or checkout.
 */
function workflowBuild(catalog, finding) {
  const root = join(catalog.repo, 'plugins/workflow');
  if (!existsSync(join(root, 'src'))) return;
  if (existsSync(join(root, 'dist/cli.js'))) finding(true, 'plugins/workflow/dist/cli.js is built');
  else finding(false, 'plugins/workflow/dist/cli.js is missing; run npm run build in plugins/workflow');
}

/** Checks this machine against what rsl sets up; findings with ok false need attention. */
export function doctor(catalog, deps) {
  const findings = [];
  const finding = (ok, message) => findings.push({ ok, message });
  const installed = {};
  for (const tool of TOOL_NAMES) {
    if (!available(deps, tool)) {
      finding(true, `${tool}: not installed`);
      continue;
    }
    try {
      if (TOOLS[tool].marketplaces(deps).includes(catalog.name)) {
        finding(true, `${tool}: ${catalog.name} marketplace added`);
      } else finding(false, `${tool}: ${catalog.name} marketplace not added; run rsl install`);
      installed[tool] = TOOLS[tool].plugins(deps).map((p) => p.id);
    } catch (error) {
      finding(false, `${tool}: ${error.message}`);
    }
  }
  brokenLinks(deps, finding);
  duplicateSkills(catalog, deps, installed, finding);
  workflowBuild(catalog, finding);
  return findings;
}
