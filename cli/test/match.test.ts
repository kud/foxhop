import { describe, it, expect } from "vitest"
import {
  findMatchingTab,
  matchesTarget,
} from "../../webext/src/popup/match.js"

const tab = (url: string, title = "", favIconUrl = "") => ({
  url,
  title,
  favIconUrl,
})

describe("hostname strategy", () => {
  it("matches the bare host", () => {
    expect(
      matchesTarget(
        { name: "chatgpt", match: "chatgpt.com" },
        tab("https://chatgpt.com/c/123"),
      ),
    ).toBe(true)
  })

  it("matches with a www. prefix on the tab", () => {
    expect(
      matchesTarget(
        { name: "chatgpt", match: "chatgpt.com" },
        tab("https://www.chatgpt.com/"),
      ),
    ).toBe(true)
  })

  it("matches subdomains", () => {
    expect(
      matchesTarget(
        { name: "gmail", match: "google.com" },
        tab("https://mail.google.com/mail/u/0"),
      ),
    ).toBe(true)
  })

  it("matches after a redirect, where the tab host differs from the saved url", () => {
    expect(
      matchesTarget(
        {
          name: "chatgpt",
          match: "chatgpt.com",
          url: "https://chat.openai.com/chat",
        },
        tab("https://chatgpt.com/c/123"),
      ),
    ).toBe(true)
  })

  it("does not match a sibling domain that merely contains the match", () => {
    expect(
      matchesTarget(
        { name: "chatgpt", match: "chatgpt.com" },
        tab("https://notchatgpt.com/"),
      ),
    ).toBe(false)
  })

  it("does not match an unrelated host", () => {
    expect(
      matchesTarget(
        { name: "chatgpt", match: "chatgpt.com" },
        tab("https://example.com/"),
      ),
    ).toBe(false)
  })

  it("folds case and a www. prefix on the match itself", () => {
    expect(
      matchesTarget(
        { name: "example", match: "WWW.Example.COM" },
        tab("https://example.com/page"),
      ),
    ).toBe(true)
  })
})

describe("other strategies mirror the background matcher", () => {
  it("prefix matches a url prefix", () => {
    const target = {
      name: "docs",
      match: "https://example.com/docs",
      strategy: "prefix" as const,
    }
    expect(matchesTarget(target, tab("https://example.com/docs/a"))).toBe(true)
    expect(matchesTarget(target, tab("https://example.com/other"))).toBe(false)
  })

  it("exact needs the full url", () => {
    const target = {
      name: "home",
      match: "https://example.com/",
      strategy: "exact" as const,
    }
    expect(matchesTarget(target, tab("https://example.com/"))).toBe(true)
    expect(matchesTarget(target, tab("https://example.com/?x=1"))).toBe(false)
  })

  it("search looks through url and title, case-insensitively", () => {
    const target = {
      name: "plan",
      match: "quarterly plan",
      strategy: "search" as const,
    }
    expect(
      matchesTarget(target, tab("https://example.com/", "Quarterly Plan")),
    ).toBe(true)
    expect(matchesTarget(target, tab("https://example.com/"))).toBe(false)
  })
})

describe("findMatchingTab", () => {
  it("returns the first matching tab, or undefined", () => {
    const target = { name: "chatgpt", match: "chatgpt.com" }
    const match = tab("https://chatgpt.com/")
    expect(
      findMatchingTab(target, [tab("https://example.com/"), match]),
    ).toBe(match)
    expect(findMatchingTab(target, [tab("https://example.com/")])).toBe(
      undefined,
    )
  })
})
