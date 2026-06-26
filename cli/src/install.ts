import { mkdirSync, writeFileSync, chmodSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import {
  HOST_NAME,
  EXTENSION_ID,
  MANIFEST_DIR,
  MANIFEST_PATH,
} from "./constants.js"

export const install = () => {
  const distDir = dirname(fileURLToPath(import.meta.url))
  const hostEntry = join(distDir, "host-cli.js")
  chmodSync(hostEntry, 0o755)

  // Firefox launches native messaging hosts with a minimal GUI PATH
  // (/usr/bin:/bin:/usr/sbin:/sbin) that excludes version-managed node
  // (mise/nvm/asdf) and Homebrew. A `#!/usr/bin/env node` shebang therefore
  // fails under a Dock launch. Point the manifest at a wrapper that hard-codes
  // the absolute node path captured at install time, so the host launches the
  // same way regardless of how Firefox was started.
  const wrapperPath = join(distDir, "host-launch.sh")
  writeFileSync(
    wrapperPath,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(hostEntry)} "$@"\n`,
  )
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
