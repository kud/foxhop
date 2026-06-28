import net from "node:net"
import { existsSync, unlinkSync } from "node:fs"
import { encodeMessage, createMessageReader } from "./framing.js"
import { SOCKET_PATH, REQUEST_TIMEOUT_MS } from "./constants.js"
import {
  readConfig,
  upsertTarget,
  removeTarget,
  toggleFavorite,
  deriveTarget,
  type Target,
} from "./config.js"

type Ack = { reqId: number; ok: boolean; action?: string; error?: string }

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
  const handleConfigRequest = (request: ConfigRequest) => {
    const reply = (extra: object) =>
      sendToExtension({ cfgId: request.cfgId, ...extra })
    try {
      switch (request.op) {
        case "config:read":
          return reply({ ok: true, targets: readConfig().targets })
        case "config:add": {
          if (!request.url) return reply({ ok: false, error: "missing url" })
          const derived = deriveTarget(request.url)
          const { targets } = upsertTarget({
            name: derived.name,
            match: derived.match,
            title: request.title || derived.title,
            url: request.url,
          })
          return reply({ ok: true, targets })
        }
        case "config:upsert": {
          if (!request.target)
            return reply({ ok: false, error: "missing target" })
          return reply({
            ok: true,
            targets: upsertTarget(request.target).targets,
          })
        }
        case "config:remove":
          return reply({
            ok: true,
            targets: removeTarget(request.name ?? "").targets,
          })
        case "config:favorite":
          toggleFavorite(request.name ?? "")
          return reply({ ok: true, targets: readConfig().targets })
        default:
          return reply({ ok: false, error: `unknown op: ${request.op}` })
      }
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
