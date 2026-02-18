/**
 * BrainBox Installer for Claude Code
 *
 * Automates setup of MCP server + hooks in ~/.claude/settings.json.
 * - install(): adds MCP server + PostToolUse + UserPromptSubmit hooks
 * - uninstall(): removes them cleanly
 *
 * Hooks use absolute paths (resolved at install time) for stability.
 * Never overwrites existing hooks — merges safely.
 */

import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import { homedir } from "node:os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Resolve the BrainBox package root (works from src/ or dist/) */
function resolvePackageRoot(): string {
  // __dirname is either src/ or dist/ — go up one level
  const root = dirname(__dirname);
  // Verify it's actually brainbox
  const pkg = join(root, "package.json");
  if (!existsSync(pkg)) {
    throw new Error(`Cannot find package.json at ${pkg}. Run from within the brainbox package.`);
  }
  return root;
}

/** Check if a hook entry belongs to BrainBox (handles both flat and nested formats) */
function isBrainBoxHook(entry: any): boolean {
  // Flat format: { type: "command", command: "...brainbox..." }
  if (entry.command && (entry.command.includes("brainbox") || entry.command.includes("brainbox-hebbian"))) {
    return true;
  }
  // Nested format: { matcher: "...", hooks: [{ type: "command", command: "...brainbox..." }] }
  if (Array.isArray(entry.hooks)) {
    return entry.hooks.some((h: any) =>
      h.command && (h.command.includes("brainbox") || h.command.includes("brainbox-hebbian"))
    );
  }
  return false;
}

interface Settings {
  hooks?: Record<string, any[]>;
  [key: string]: unknown;
}

function readSettings(): Settings {
  const settingsPath = join(homedir(), ".claude", "settings.json");
  if (!existsSync(settingsPath)) return {};
  try {
    return JSON.parse(readFileSync(settingsPath, "utf-8"));
  } catch {
    console.error(`  Warning: ~/.claude/settings.json is malformed. Creating backup and starting fresh.`);
    copyFileSync(settingsPath, settingsPath + ".malformed-backup");
    return {};
  }
}

function writeSettings(settings: Settings): void {
  const claudeDir = join(homedir(), ".claude");
  const settingsPath = join(claudeDir, "settings.json");

  // Ensure ~/.claude/ exists
  if (!existsSync(claudeDir)) mkdirSync(claudeDir, { recursive: true });

  // Backup existing
  if (existsSync(settingsPath)) {
    copyFileSync(settingsPath, settingsPath + ".brainbox-backup");
  }

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

function addHook(settings: Settings, hookName: string, command: string): boolean {
  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks[hookName]) settings.hooks[hookName] = [];

  // Check if already installed
  if (settings.hooks[hookName].some(isBrainBoxHook)) {
    console.log(`  ${hookName}: already installed (skipped)`);
    return false;
  }

  settings.hooks[hookName].push({ type: "command", command });
  console.log(`  ${hookName}: added`);
  return true;
}

function removeHook(settings: Settings, hookName: string): boolean {
  if (!settings.hooks?.[hookName]) return false;
  const before = settings.hooks[hookName].length;
  settings.hooks[hookName] = settings.hooks[hookName].filter((e) => !isBrainBoxHook(e));
  const removed = before - settings.hooks[hookName].length;

  // Clean up empty arrays
  if (settings.hooks[hookName].length === 0) delete settings.hooks[hookName];
  if (Object.keys(settings.hooks).length === 0) delete settings.hooks;

  if (removed > 0) {
    console.log(`  ${hookName}: removed`);
    return true;
  }
  return false;
}

export function install(): void {
  console.log("\nBrainBox Installer\n");

  // 1. Resolve paths
  const root = resolvePackageRoot();
  const hookPath = join(root, "src", "hook.ts");
  const promptHookPath = join(root, "src", "prompt-hook.ts");
  const mcpPath = join(root, "src", "mcp.ts");

  // Verify hook files exist
  for (const [name, path] of [["hook.ts", hookPath], ["prompt-hook.ts", promptHookPath], ["mcp.ts", mcpPath]]) {
    if (!existsSync(path)) {
      console.error(`Error: ${name} not found at ${path}`);
      process.exit(1);
    }
  }

  console.log(`  Package root: ${root}\n`);

  // 2. Read settings
  const settings = readSettings();

  // 3. Add hooks
  let changed = false;
  console.log("Hooks:");
  changed = addHook(settings, "PostToolUse", `npx tsx ${hookPath}`) || changed;
  changed = addHook(settings, "UserPromptSubmit", `npx tsx ${promptHookPath}`) || changed;

  // 4. Write settings
  if (changed) {
    writeSettings(settings);
    console.log("\n  Settings saved to ~/.claude/settings.json");
    console.log("  Backup at ~/.claude/settings.json.brainbox-backup");
  }

  // 5. Add MCP server
  console.log("\nMCP Server:");
  try {
    // Check if already registered
    const mcpList = execSync("claude mcp list 2>/dev/null", { encoding: "utf-8" });
    if (mcpList.includes("brainbox")) {
      console.log("  brainbox: already registered (skipped)");
    } else {
      execSync(`claude mcp add brainbox -- npx tsx ${mcpPath}`, { stdio: "pipe" });
      console.log("  brainbox: registered");
    }
  } catch {
    console.log("  Warning: 'claude' CLI not found. MCP server not registered.");
    console.log("  Manual: claude mcp add brainbox -- npx tsx " + mcpPath);
  }

  // 6. Ensure DB directory exists
  const dbDir = join(homedir(), ".brainbox");
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
    console.log(`\nDatabase: created ${dbDir}/`);
  }

  console.log("\nDone! BrainBox will learn from your next Claude Code session.\n");
}

export function uninstall(): void {
  console.log("\nBrainBox Uninstaller\n");

  // 1. Read settings
  const settings = readSettings();

  // 2. Remove hooks
  let changed = false;
  console.log("Hooks:");
  changed = removeHook(settings, "PostToolUse") || changed;
  changed = removeHook(settings, "UserPromptSubmit") || changed;

  if (!changed) {
    console.log("  No BrainBox hooks found");
  } else {
    writeSettings(settings);
    console.log("\n  Settings saved to ~/.claude/settings.json");
  }

  // 3. Remove MCP server
  console.log("\nMCP Server:");
  try {
    execSync("claude mcp remove brainbox 2>/dev/null", { stdio: "pipe" });
    console.log("  brainbox: removed");
  } catch {
    console.log("  brainbox: not registered (skipped)");
  }

  console.log("\nDone! BrainBox hooks and MCP server removed.");
  console.log("Database at ~/.brainbox/ was preserved. Delete manually if desired.\n");
}
