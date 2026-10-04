import { homedir } from "node:os"
import { join } from "node:path"

// Shared filesystem locations for tabs.json and the generated Raycast
// scripts. This module sits below config.ts and sync.ts so neither has to
// import the other for a path (config.ts used to import sync.ts for
// defaultScriptsDir, while sync.ts imports config.ts for readConfig).
const xdgConfigHome = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config")
export const CONFIG_DIR = join(xdgConfigHome, "foxhop")
export const CONFIG_PATH = join(CONFIG_DIR, "tabs.json")
export const SCHEMA_PATH = join(CONFIG_DIR, "tabs.schema.json")

export const defaultScriptsDir = () => join(CONFIG_DIR, "scripts")
