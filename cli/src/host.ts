import net from "node:net"
import { existsSync, unlinkSync } from "node:fs"
import { encodeMessage, createMessageReader } from "./framing.js"
import { SOCKET_PATH, REQUEST_TIMEOUT_MS } from "./constants.js"

type Ack = { reqId: number; ok: boolean; action?: string; error?: string }

export const runHost = () => {
  const pending = new Map<number, (ack: Ack) => void>()
  let sequence = 0

  const sendToExtension = (message: unknown) =>
    process.stdout.write(encodeMessage(message))

  process.stdin.on(
    "data",
    createMessageReader((ack: Ack) => {
      const resolve = pending.get(ack.reqId)
      if (!resolve) return
      pending.delete(ack.reqId)
      resolve(ack)
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
