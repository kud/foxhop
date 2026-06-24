import { describe, it, expect } from "vitest"
import { encodeMessage, createMessageReader } from "../src/framing.js"

describe("framing", () => {
  it("round-trips a single message", () => {
    const received: unknown[] = []
    const read = createMessageReader((message) => received.push(message))
    read(encodeMessage({ hello: "world", n: 42 }))
    expect(received).toEqual([{ hello: "world", n: 42 }])
  })

  it("decodes multiple messages from one chunk", () => {
    const received: unknown[] = []
    const read = createMessageReader((message) => received.push(message))
    read(Buffer.concat([encodeMessage({ a: 1 }), encodeMessage({ b: 2 })]))
    expect(received).toEqual([{ a: 1 }, { b: 2 }])
  })

  it("reassembles a message split across chunks", () => {
    const received: unknown[] = []
    const read = createMessageReader((message) => received.push(message))
    const full = encodeMessage({ msg: "split me" })
    read(full.subarray(0, 3))
    expect(received).toHaveLength(0)
    read(full.subarray(3))
    expect(received).toEqual([{ msg: "split me" }])
  })
})
