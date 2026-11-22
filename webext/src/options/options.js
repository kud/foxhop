// The toolbar icon variants under src/icons/toolbar/, stored under
// "toolbarIcon" in browser.storage.local. The background script applies the
// choice, so writing the key is the whole of this page's job.
const TOOLBAR_ICONS = ["leaping-fox", "fox-head", "fox-tab", "tail-hop"]
const DEFAULT_TOOLBAR_ICON = "leaping-fox"
const iconPicker = document.getElementById("icon-picker")

const checkToolbarIcon = (id) => {
  const choice = TOOLBAR_ICONS.includes(id) ? id : DEFAULT_TOOLBAR_ICON
  const picked = iconPicker.querySelector(`input[value="${choice}"]`)
  if (picked) picked.checked = true
}

iconPicker.addEventListener("change", (event) => {
  if (!TOOLBAR_ICONS.includes(event.target.value)) return
  browser.storage.local.set({ toolbarIcon: event.target.value }).catch(() => {})
})

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "toolbarIcon" in changes) {
    checkToolbarIcon(changes.toolbarIcon.newValue)
  }
})

const load = async () => {
  try {
    const stored = await browser.storage.local.get("toolbarIcon")
    checkToolbarIcon(stored?.toolbarIcon)
  } catch {}
}

load()

// --- Page access -----------------------------------------------------------
// <all_urls> is optional: paste and read need it, focus does not. Firefox only
// shows the permission prompt for a request made inside a user gesture, so the
// click handler calls permissions.request before awaiting anything else.
const PAGE_ACCESS = { origins: ["<all_urls>"] }
const accessDot = document.getElementById("page-access-dot")
const accessState = document.getElementById("page-access-state")
const grantButton = document.getElementById("page-access-grant")
const revokeButton = document.getElementById("page-access-revoke")

const showPageAccess = (granted) => {
  accessDot.dataset.tone = granted ? "on" : "idle"
  accessState.textContent = granted
    ? "Granted: paste and read can reach your tabs"
    : "Not granted: paste and read will ask you to come here"
  grantButton.hidden = granted
  revokeButton.hidden = !granted
}

const refreshPageAccess = async () => {
  try {
    showPageAccess(await browser.permissions.contains(PAGE_ACCESS))
  } catch {
    showPageAccess(false)
  }
}

grantButton.addEventListener("click", () => {
  browser.permissions
    .request(PAGE_ACCESS)
    .then(showPageAccess)
    .catch(refreshPageAccess)
})

revokeButton.addEventListener("click", () => {
  browser.permissions
    .remove(PAGE_ACCESS)
    .then(refreshPageAccess)
    .catch(refreshPageAccess)
})

// Granted or revoked elsewhere (about:addons, another settings tab).
browser.permissions.onAdded.addListener(refreshPageAccess)
browser.permissions.onRemoved.addListener(refreshPageAccess)

refreshPageAccess()
