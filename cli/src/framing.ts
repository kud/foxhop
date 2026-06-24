import { endianness } from "node:os"

const littleEndian = endianness() === "LE"

export const encodeMessage = (message: unknown): Buffer => {
  const json = Buffer.from(JSON.stringify(message), "utf8")
  const header = Buffer.allocUnsafe(4)
  if (littleEndian) header.writeUInt32LE(json.length, 0)
  else header.writeUInt32BE(json.length, 0)
  return Buffer.concat([header, json])
}

export const createMessageReader = (onMessage: (message: any) => void) => {
  let buffer = Buffer.alloc(0)
  return (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    while (buffer.length >= 4) {
      const length = littleEndian
        ? buffer.readUInt32LE(0)
        : buffer.readUInt32BE(0)
      if (buffer.length < 4 + length) break
      const json = buffer.subarray(4, 4 + length).toString("utf8")
      buffer = buffer.subarray(4 + length)
      onMessage(JSON.parse(json))
    }
  }
}
