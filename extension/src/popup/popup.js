const listEl = document.getElementById("list")
const stateEl = document.getElementById("state")
const searchEl = document.getElementById("search")
const addEl = document.getElementById("add-current")

let targets = []

const send = (message) => browser.runtime.sendMessage(message)

const showState = (text) => {
  stateEl.textContent = text
  stateEl.hidden = false
  listEl.hidden = true
}

const orderedTargets = () => [
  ...targets.filter((t) => t.favorite),
  ...targets.filter((t) => !t.favorite),
]

const filtered = () => {
  const q = searchEl.value.trim().toLowerCase()
  if (!q) return orderedTargets()
  return orderedTargets().filter((t) =>
    `${t.name} ${t.title ?? ""} ${t.match}`.toLowerCase().includes(q),
  )
}

const button = (cls, label, title, onClick) => {
  const el = document.createElement("button")
  el.type = "button"
  el.className = `row-btn ${cls}`
  el.textContent = label
  el.title = title
  el.addEventListener("click", (event) => {
    event.stopPropagation()
    onClick()
  })
  return el
}

const renderRow = (target) => {
  const row = document.createElement("li")
  row.className = "row"

  const monogram = document.createElement("span")
  monogram.className = "monogram"
  monogram.textContent = (target.title ?? target.name).slice(0, 1)

  const text = document.createElement("span")
  text.className = "row-text"
  const name = document.createElement("div")
  name.className = "row-name"
  name.textContent = target.title ?? target.name
  const match = document.createElement("div")
  match.className = "row-match"
  match.textContent = target.match
  text.append(name, match)

  const fav = button(
    target.favorite ? "fav on" : "fav",
    target.favorite ? "★" : "☆",
    "Toggle favourite",
    async () => {
      const ack = await send({ type: "favorite", name: target.name })
      if (ack?.ok) refresh(ack.targets)
    },
  )
  const remove = button("remove", "×", "Delete target", async () => {
    const ack = await send({ type: "remove", name: target.name })
    if (ack?.ok) refresh(ack.targets)
  })

  row.append(monogram, text, fav, remove)
  row.addEventListener("click", () => focus(target))
  return row
}

const render = () => {
  const rows = filtered()
  listEl.replaceChildren(...rows.map(renderRow))
  if (!targets.length) {
    showState("No targets yet. Add the current tab to get started.")
  } else if (!rows.length) {
    showState("No matches.")
  } else {
    stateEl.hidden = true
    listEl.hidden = false
  }
}

const refresh = (next) => {
  if (Array.isArray(next)) targets = next
  render()
}

const focus = async (target) => {
  const ack = await send({ type: "focus", target })
  if (ack?.ok) window.close()
}

const load = async () => {
  const status = await send({ type: "status" }).catch(() => null)
  if (!status?.connected) {
    showState("Native host not connected. Run ‘foxhop install’.")
    addEl.disabled = true
    return
  }
  const ack = await send({ type: "targets" }).catch(() => null)
  if (!ack?.ok) {
    showState("Couldn’t reach the foxhop host.")
    return
  }
  refresh(ack.targets ?? [])
}

addEl.addEventListener("click", async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (!tab?.url) return
  const ack = await send({ type: "add", url: tab.url, title: tab.title })
  if (ack?.ok) refresh(ack.targets)
})

searchEl.addEventListener("input", render)

load()
