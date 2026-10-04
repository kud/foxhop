import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { findMatchingTab, matchesTarget } from "../../webext/src/match.js"

const tab = (url: string, title = "", favIconUrl = "") => ({
  url,
  title,
  favIconUrl,
})

type Case = {
  name: string
  target: { name: string; match: string; url?: string; strategy?: "hostname" | "prefix" | "exact" | "search" }
  tabUrl: string
  tabTitle?: string
  expected: boolean
}

const cases: Case[] = [
  {
    name: "exact host",
    target: { name: "chatgpt", match: "chatgpt.com" },
    tabUrl: "https://chatgpt.com/c/123",
    expected: true,
  },
  {
    name: "www. prefix on the tab",
    target: { name: "chatgpt", match: "chatgpt.com" },
    tabUrl: "https://www.chatgpt.com/",
    expected: true,
  },
  {
    name: "www. prefix and case folded on the match",
    target: { name: "example", match: "WWW.Example.COM" },
    tabUrl: "https://example.com/page",
    expected: true,
  },
  {
    name: "subdomain",
    target: { name: "gmail", match: "google.com" },
    tabUrl: "https://mail.google.com/mail/u/0",
    expected: true,
  },
  {
    name: "redirect host (tab host differs from saved url)",
    target: {
      name: "chatgpt",
      match: "chatgpt.com",
      url: "https://chat.openai.com/chat",
    },
    tabUrl: "https://chatgpt.com/c/123",
    expected: true,
  },
  {
    name: "sibling domain is not a subdomain",
    target: { name: "chatgpt", match: "chatgpt.com" },
    tabUrl: "https://notchatgpt.com/",
    expected: false,
  },
  {
    name: "unrelated host",
    target: { name: "chatgpt", match: "chatgpt.com" },
    tabUrl: "https://example.com/",
    expected: false,
  },
  {
    name: "prefix strategy matches a url prefix",
    target: {
      name: "docs",
      match: "https://example.com/docs",
      strategy: "prefix",
    },
    tabUrl: "https://example.com/docs/a",
    expected: true,
  },
  {
    name: "prefix strategy rejects other paths",
    target: {
      name: "docs",
      match: "https://example.com/docs",
      strategy: "prefix",
    },
    tabUrl: "https://example.com/other",
    expected: false,
  },
  {
    name: "exact strategy needs the full url",
    target: {
      name: "home",
      match: "https://example.com/",
      strategy: "exact",
    },
    tabUrl: "https://example.com/",
    expected: true,
  },
  {
    name: "exact strategy rejects query strings",
    target: {
      name: "home",
      match: "https://example.com/",
      strategy: "exact",
    },
    tabUrl: "https://example.com/?x=1",
    expected: false,
  },
  {
    name: "search strategy looks through url and title",
    target: {
      name: "plan",
      match: "quarterly plan",
      strategy: "search",
    },
    tabUrl: "https://example.com/",
    tabTitle: "Quarterly Plan",
    expected: true,
  },
  {
    name: "search strategy misses without title or url hit",
    target: {
      name: "plan",
      match: "quarterly plan",
      strategy: "search",
    },
    tabUrl: "https://example.com/",
    expected: false,
  },
]

describe("shared matcher", () => {
  it.each(cases)("$name", ({ target, tabUrl, tabTitle, expected }) => {
    expect(matchesTarget(target, tab(tabUrl, tabTitle ?? ""))).toBe(expected)
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

describe("background uses the shared matcher", () => {
  it("imports match.js and keeps no hostname .includes(match)", () => {
    const background = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        "../../webext/src/background.js",
      ),
      "utf8",
    )
    expect(background).toMatch(/from ["']\.\/match\.js["']/)
    expect(background).toContain("matchesTarget")
    expect(background).not.toContain(".includes(match)")
  })
})
