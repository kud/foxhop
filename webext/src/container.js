// Container lookup by name, shared by the background page and the tests.
// The browser APIs are passed in rather than read from the global `browser`,
// so vitest in cli/test can drive it with a fake.
//
// A container is never created here: an unknown name is an error that lists
// the names that do exist, so a typo cannot quietly start a fresh, empty
// container with none of the user's sign-ins.

export const normalizeContainerName = (name) =>
  String(name ?? "")
    .trim()
    .toLowerCase()

const listContainers = async (contextualIdentities) => {
  if (!contextualIdentities?.query) return null
  try {
    return await contextualIdentities.query({})
  } catch {
    // Firefox rejects the query when containers are turned off.
    return null
  }
}

// Resolves a container name (case and surrounding spaces ignored) to its
// cookieStoreId: `{ cookieStoreId, name }` on success, `{ error }` otherwise.
export const resolveContainer = async (contextualIdentities, name) => {
  const wanted = normalizeContainerName(name)
  if (!wanted) return { error: "container name cannot be empty" }
  const containers = await listContainers(contextualIdentities)
  if (!containers)
    return {
      error:
        "containers are turned off in Firefox: enable them in Settings → Privacy & Security → Containers",
    }
  const found = containers.find(
    (container) => normalizeContainerName(container.name) === wanted,
  )
  if (found) return { cookieStoreId: found.cookieStoreId, name: found.name }
  const available = containers.map((container) => container.name)
  return {
    error: available.length
      ? `unknown container "${name}" (available: ${available.join(", ")})`
      : `unknown container "${name}": no containers exist yet`,
  }
}

// What this extension can do beyond focusing, answered to the CLI's
// `capabilities` probe before it sends a request that names a container.
export const EXTENSION_CAPABILITIES = ["container"]

// Firefox refuses a container tab in a private window, so a container tab goes
// to the last-focused window when it is a normal one, else to any normal
// window: `{ windowId }`, or `{ error }` when every window is private.
export const pickContainerWindow = (lastFocused, windows) => {
  if (lastFocused && !lastFocused.incognito) return { windowId: lastFocused.id }
  const normal = (windows ?? []).find((win) => !win.incognito)
  if (normal) return { windowId: normal.id }
  return {
    error:
      "containers are not available in private windows: open a normal Firefox window",
  }
}
