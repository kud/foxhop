const HOST_NAME = "io.kud.foxhop"

const matchesTab = (tab, match, strategy) => {
  if (!tab.url) return false
  if (strategy === "exact") return tab.url === match
  if (strategy === "prefix") return tab.url.startsWith(match)
  if (strategy === "search") {
    return `${tab.url} ${tab.title ?? ""}`
      .toLowerCase()
      .includes(match.toLowerCase())
  }
  try {
    return new URL(tab.url).hostname.includes(match)
  } catch {
    return false
  }
}

const mostRecent = (tabs) =>
  tabs.reduce((best, tab) =>
    (tab.lastAccessed ?? 0) > (best.lastAccessed ?? 0) ? tab : best,
  )

const chooseTab = (matches, pick) => {
  if (pick === "first") {
    return [...matches].sort(
      (a, b) => a.windowId - b.windowId || a.index - b.index,
    )[0]
  }
  if (pick === "pinned") {
    const pinned = matches.filter((tab) => tab.pinned)
    return mostRecent(pinned.length ? pinned : matches)
  }
  return mostRecent(matches)
}

const focusWindow = async (windowId) => {
  const win = await browser.windows.get(windowId)
  await browser.windows.update(windowId, {
    focused: true,
    ...(win.state === "minimized" ? { state: "normal" } : {}),
  })
}

const focusTab = async ({
  match,
  strategy = "hostname",
  pick = "recent",
  url,
}) => {
  const tabs = await browser.tabs.query({})
  const matches = tabs.filter((tab) => matchesTab(tab, match, strategy))

  if (matches.length) {
    const tab = chooseTab(matches, pick)
    await browser.tabs.update(tab.id, { active: true })
    await focusWindow(tab.windowId)
    return {
      action: "focused",
      tabId: tab.id,
      windowId: tab.windowId,
      matchCount: matches.length,
    }
  }

  if (url) {
    const created = await browser.tabs.create({ url })
    await focusWindow(created.windowId)
    return { action: "opened", tabId: created.id, windowId: created.windowId }
  }

  return { action: "not-found" }
}

const listTabs = async () => {
  const tabs = await browser.tabs.query({})
  return {
    tabs: tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      url: tab.url,
      windowId: tab.windowId,
      index: tab.index,
      pinned: tab.pinned,
      lastAccessed: tab.lastAccessed,
      favIconUrl: tab.favIconUrl,
    })),
  }
}

const handle = async (request) => {
  if (request.op === "list") return { ok: true, ...(await listTabs()) }
  return { ok: true, ...(await focusTab(request)) }
}

let port

const connect = () => {
  port = browser.runtime.connectNative(HOST_NAME)

  port.onMessage.addListener(async (request) => {
    const { reqId } = request
    try {
      const result = await handle(request)
      port.postMessage({ reqId, ...result })
    } catch (error) {
      port.postMessage({ reqId, ok: false, error: String(error) })
    }
  })

  port.onDisconnect.addListener(() => {
    port = undefined
    setTimeout(connect, 1000)
  })
}

connect()
