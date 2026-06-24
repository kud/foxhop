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

  mkdirSync(MANIFEST_DIR, { recursive: true })
  const manifest = {
    name: HOST_NAME,
    description: "foxhop native messaging host",
    path: hostEntry,
    type: "stdio",
    allowed_extensions: [EXTENSION_ID],
  }
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n")

  process.stdout.write(
    `foxhop: installed native host manifest\n  manifest → ${MANIFEST_PATH}\n  host     → ${hostEntry}\n`,
  )
}
