// Stands in for the WebExtension `browser` API so the real popup runs on a
// plain web page. State lives in memory, seeded from the fixture named by
// ?fixture=<name>; writes are applied in memory and logged, nothing else.
;(() => {
  const params = new URLSearchParams(location.search)
  const name = params.get("fixture") ?? "typical"
  const scriptUrl = document.currentScript.src

  const request = new XMLHttpRequest()
  request.open("GET", new URL(`fixtures/${name}.json`, scriptUrl), false)
  request.send()
  if (request.status !== 200) throw new Error(`preview: no fixture "${name}"`)
  const fixture = JSON.parse(request.responseText)

  const log = (call, detail) => console.info(`[preview] ${call}`, detail === undefined ? "" : JSON.stringify(detail))
  const clone = (value) => JSON.parse(JSON.stringify(value ?? null))

  let targets = clone(fixture.targets) ?? []
  const tabs = clone(fixture.tabs) ?? []
  const stored = clone(fixture.storage) ?? {}
  const replies = fixture.replies ?? {}

  const slug = (text) =>
    text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "target"

  const handlers = {
    status: () => replies.status ?? { connected: fixture.connected !== false },
    targets: () => ({ ok: true, targets }),
    favorite: ({ name: id }) => {
      targets = targets.map((t) => (t.name === id ? { ...t, favorite: !t.favorite } : t))
      return { ok: true, targets }
    },
    remove: ({ name: id }) => {
      targets = targets.filter((t) => t.name !== id)
      return { ok: true, targets }
    },
    upsert: ({ target }) => {
      const exists = targets.some((t) => t.name === target.name)
      targets = exists
        ? targets.map((t) => (t.name === target.name ? target : t))
        : [...targets, target]
      return { ok: true, targets }
    },
    add: ({ url, title }) => {
      if (replies.add) return replies.add
      const host = new URL(url).hostname
      const label = title || host
      targets = [...targets, { name: slug(label), title: label, match: host, url }]
      return { ok: true, targets }
    },
    focus: () => replies.focus ?? { ok: true },
  }

  const sendMessage = async (message) => {
    const handler = handlers[message?.type]
    if (!handler) throw new Error(`preview: unhandled message type "${message?.type}"`)
    const reply = handler(message)
    if (message.type !== "status" && message.type !== "targets") log(`runtime.sendMessage`, message)
    return clone(reply)
  }

  const matchesQuery = (tab, query) =>
    Object.entries(query ?? {}).every(([key, want]) => key === "currentWindow" || tab[key] === want)

  const changeListeners = []

  globalThis.browser = {
    runtime: { sendMessage },
    browserAction: {
      setIcon: async (detail) => log("browserAction.setIcon", detail),
    },
    storage: {
      onChanged: {
        addListener: (listener) => changeListeners.push(listener),
      },
      local: {
        get: async (keys) => {
          if (keys == null) return clone(stored)
          const list = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys)
          return clone(Object.fromEntries(list.filter((key) => key in stored).map((key) => [key, stored[key]])))
        },
        set: async (items) => {
          log("storage.local.set", items)
          const changes = Object.fromEntries(
            Object.entries(clone(items) ?? {}).map(([key, value]) => [
              key,
              { oldValue: clone(stored[key]), newValue: clone(value) },
            ]),
          )
          Object.assign(stored, clone(items))
          for (const listener of changeListeners) listener(clone(changes), "local")
        },
      },
    },
    tabs: {
      query: async (query) => clone(tabs.filter((tab) => matchesQuery(tab, query))),
      update: async (id, props) => {
        log("tabs.update", { id, ...props })
        const tab = tabs.find((t) => t.id === id)
        if (tab) Object.assign(tab, props)
        return clone(tab)
      },
      create: async (props) => {
        log("tabs.create", props)
        const tab = { id: Math.max(0, ...tabs.map((t) => t.id)) + 1, windowId: 1, ...props }
        tabs.push(tab)
        return clone(tab)
      },
    },
    windows: {
      get: async (id) => ({ id, focused: true, state: "normal" }),
      update: async (id, props) => {
        log("windows.update", { id, ...props })
        return { id, ...props }
      },
    },
  }
})()
