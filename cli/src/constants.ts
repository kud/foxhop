import { homedir } from "node:os"
import { join } from "node:path"

export const HOST_NAME = "io.kud.foxhop"
export const EXTENSION_ID = "foxhop@kud.io"

export const SOCKET_PATH = join(homedir(), ".foxhop.sock")

export const MANIFEST_DIR = join(
  homedir(),
  "Library",
  "Application Support",
  "Mozilla",
  "NativeMessagingHosts",
)
export const MANIFEST_PATH = join(MANIFEST_DIR, `${HOST_NAME}.json`)

export const REQUEST_TIMEOUT_MS = 3000
