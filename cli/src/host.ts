import net from "node:net"
import { existsSync, unlinkSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { encodeMessage, createMessageReader } from "./framing.js"
import { SOCKET_PATH, REQUEST_TIMEOUT_MS } from "./constants.js"
import {
  readConfig,
  findTarget,
  upsertTarget,
  removeTarget,
  toggleFavorite,
  deriveTarget,
  allocateTargetName,
  slugify,
  cliEntryForScripts,
  type Target,
} from "./config.js"
import { autoSync } from "./sync.js"

type Ack = { reqId: number; ok: boolean; action?: string; error?: string }

// Applies a popup-initiated config mutation against tabs.json and returns the
// reply payload (the resulting targets list so the popup can re-render).
// Exported for tests; runHost wraps it with the native-messaging transport.
export const handleConfigMutation = (request: ConfigRequest) => {
  const resync = () =>
    autoSync(
      process.execPath,
      cliEntryForScripts(fileURLToPath(import.meta.url)),
    )
  switch (request.op) {
    case "config:read":
      return { ok: true, targets: readConfig(resync).targets }
    case "config:add": {
      if (!request.url) return { ok: false, error: "missing url" }
      const derived = deriveTarget(request.url)
      // The id is the slug of the popup's title (or the derived one) — the
      // popup never sends a name. Re-adding the same site refreshes its URL
      // without wiping user-set fields; a taken id with a different match
      // gets a -2, -3, … suffix instead of overwriting.
      const title = request.title || derived.title
      const { targets: current } = readConfig(resync)
      const base = slugify(title) || slugify(derived.match) || derived.name
      const name = allocateTargetName(current, base, derived.match)
      const existing = findTarget({ targets: current }, name)
      const { targets } = upsertTarget(
        {
          ...existing,
          name,
          match: existing?.match ?? derived.match,
          title,
          url: request.url,
        },
        resync,
      )
      resync()
      return { ok: true, targets }
    }
    case "config:upsert": {
      if (!request.target) return { ok: false, error: "missing target" }
      const result = {
        ok: true,
        targets: upsertTarget(request.target, resync).targets,
      }
      resync()
      return result
    }
    case "config:remove": {
      const result = removeTarget(request.name ?? "", resync)
      if (result.removed) resync()
      return { ok: true, targets: result.targets }
    }
    case "config:favorite": {
      const { found } = toggleFavorite(request.name ?? "", resync)
      if (found) resync()
      return { ok: true, targets: readConfig().targets }
    }
    default:
      return { ok: false, error: `unknown op: ${request.op}` }
  }
}

// Requests the extension's popup sends *up* to the host (the only component with
// filesystem access to tabs.json). Distinguished from acks by their `config:` op.
type ConfigRequest = {
  cfgId: number
  op: string
  target?: Target
  name?: string
  url?: string
  title?: string
}

export const runHost = () => {
  const pending = new Map<number, (ack: Ack) => void>()
  let sequence = 0

  const sendToExtension = (message: unknown) =>
    process.stdout.write(encodeMessage(message))

  // Serve a config request from the extension popup against tabs.json, then
  // reply with the resulting targets list so the popup can re-render.
  // Mutations resync the generated scripts exactly like the CLI does.
  const handleConfigRequest = (request: ConfigRequest) => {
    const reply = (extra: object) =>
      sendToExtension({ cfgId: request.cfgId, ...extra })
    try {
      return reply(handleConfigMutation(request))
    } catch (error) {
      reply({ ok: false, error: String(error) })
    }
  }

  process.stdin.on(
    "data",
    createMessageReader((message: Ack & Partial<ConfigRequest>) => {
      if (typeof message.op === "string") {
        return handleConfigRequest(message as ConfigRequest)
      }
      const resolve = pending.get(message.reqId)
      if (!resolve) return
      pending.delete(message.reqId)
      resolve(message)
    }),
  )
  // Leave no stale socket behind: a dead socket file refuses connections
  // (ECONNREFUSED) and would make the CLI think the host is unreachable.
  const cleanup = () => {
    try {
      if (existsSync(SOCKET_PATH)) unlinkSync(SOCKET_PATH)
    } catch {}
  }
  process.stdin.on("end", () => {
    cleanup()
    process.exit(0)
  })
  process.on("exit", cleanup)

  cleanup()

  const server = net.createServer((socket) => {
    socket.setEncoding("utf8")
    let raw = ""
    socket.on("data", (chunk: string) => {
      raw += chunk
      const newline = raw.indexOf("\n")
      if (newline === -1) return

      let request: unknown
      try {
        request = JSON.parse(raw.slice(0, newline))
      } catch {
        socket.end(JSON.stringify({ ok: false, error: "bad-request" }))
        return
      }

      const reqId = ++sequence
      const timeout = setTimeout(() => {
        if (!pending.has(reqId)) return
        pending.delete(reqId)
        socket.end(JSON.stringify({ ok: false, error: "timeout" }))
      }, REQUEST_TIMEOUT_MS)

      pending.set(reqId, (ack) => {
        clearTimeout(timeout)
        socket.end(JSON.stringify(ack))
      })

      sendToExtension({ reqId, ...(request as object) })
    })
  })

  server.on("error", (error) => {
    process.stderr.write(`foxhop-host: socket error: ${error.message}\n`)
  })
  server.listen(SOCKET_PATH)
}
