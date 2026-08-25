import { mkdirSync, writeFileSync, chmodSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import {
  HOST_NAME,
  EXTENSION_ID,
  MANIFEST_DIR,
  MANIFEST_PATH,
} from "./constants.js"
import { CONFIG_DIR } from "./config.js"

// Firefox launches native messaging hosts with a minimal GUI PATH
// (/usr/bin:/bin:/usr/sbin:/sbin) that excludes version-managed node
// (mise/nvm/asdf) and Homebrew. A `#!/usr/bin/env node` shebang therefore fails
// under a Dock launch, so the manifest points at a wrapper carrying an absolute
// node path instead.
//
// That wrapper has to survive two expiries, both of which unhook the extension
// silently — the manifest still exists, it just names a path that stopped
// working:
//   · it must not live in the package's own dist/. It is generated, so it is
//     absent from the published tarball, and npm replaces dist/ wholesale on
//     every version bump — the wrapper would vanish on each upgrade.
//   · the node path captured at install time is version-scoped under mise, so a
//     runtime bump strands it. Fall through to the version-agnostic shim, which
//     resolves at launch and works under the minimal GUI PATH.
export const wrapperScript = (nodePath: string, hostEntry: string) => `#!/bin/sh
node_bin=${JSON.stringify(nodePath)}
[ -x "$node_bin" ] || node_bin="$HOME/.local/share/mise/shims/node"
[ -x "$node_bin" ] || node_bin=node
exec "$node_bin" ${JSON.stringify(hostEntry)} "$@"
`

export const install = (
  distDir = dirname(fileURLToPath(import.meta.url)),
): void => {
  const hostEntry = join(distDir, "host-cli.js")
  chmodSync(hostEntry, 0o755)

  mkdirSync(CONFIG_DIR, { recursive: true })
  const wrapperPath = join(CONFIG_DIR, "host-launch.sh")
  writeFileSync(wrapperPath, wrapperScript(process.execPath, hostEntry))
  chmodSync(wrapperPath, 0o755)

  mkdirSync(MANIFEST_DIR, { recursive: true })
  const manifest = {
    name: HOST_NAME,
    description: "foxhop native messaging host",
    path: wrapperPath,
    type: "stdio",
    allowed_extensions: [EXTENSION_ID],
  }
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n")

  process.stdout.write(
    `foxhop: installed native host manifest\n  manifest → ${MANIFEST_PATH}\n  host     → ${wrapperPath}\n  node     → ${process.execPath}\n`,
  )
}
