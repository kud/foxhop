import net from "node:net"
import { SOCKET_PATH } from "./constants.js"

export const sendToHost = (request: object, timeoutMs = 5000): Promise<any> =>
  new Promise((resolve, reject) => {
    const socket = net.createConnection(SOCKET_PATH)
    let response = ""

    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error("timeout"))
    }, timeoutMs)

    socket.setEncoding("utf8")
    socket.on("connect", () => socket.write(JSON.stringify(request) + "\n"))
    socket.on("data", (chunk: string) => (response += chunk))
    socket.on("end", () => {
      clearTimeout(timer)
      try {
        resolve(JSON.parse(response))
      } catch {
        resolve(null)
      }
    })
    socket.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
