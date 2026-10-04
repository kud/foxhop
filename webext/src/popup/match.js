// Pure target-to-tab matching for the popup (no browser APIs, so vitest in
// cli/test can import it directly).
//
// Strategy semantics mirror the background matcher (webext/src/background.js)
// for prefix, exact and search. The hostname strategy is deliberately
// stricter than the background's substring check: a bare `includes` lets a
// sibling domain match (notchatgpt.com ends with chatgpt.com), so here the
// tab host must equal the target match or sit under it as a subdomain, after
// folding case and a leading www. on both sides. That also covers redirects:
// the tab host is compared against target.match, never the saved url.

export const normalizeHost = (host) =>
  String(host ?? "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "")

export const hostOfUrl = (url) => {
  try {
    return normalizeHost(new URL(url).hostname)
  } catch {
    return null
  }
}

const matchesHostname = (tab, match) => {
  const host = hostOfUrl(tab.url ?? "")
  const want = normalizeHost(match)
  if (!host || !want) return false
  return host === want || host.endsWith(`.${want}`)
}

export const matchesTarget = (target, tab) => {
  const match = target.match ?? ""
  const strategy = target.strategy ?? "hostname"
  if (strategy === "exact") return tab.url === match
  if (strategy === "prefix")
    return typeof tab.url === "string" && tab.url.startsWith(match)
  if (strategy === "search")
    return `${tab.url ?? ""} ${tab.title ?? ""}`
      .toLowerCase()
      .includes(match.toLowerCase())
  return matchesHostname(tab, match)
}

export const findMatchingTab = (target, tabs) =>
  (tabs ?? []).find((tab) => matchesTarget(target, tab))
