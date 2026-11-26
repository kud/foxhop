// Whether the extension can honour a container, asked before any request that
// names one. An extension predating containers would ignore the field and act
// first — paste into, or open, a tab in the default container — so the CLI
// cannot wait for the ack to find out. An old extension treats the
// `capabilities` probe as a focus with nothing to match and no url: it answers
// `not-found` and touches no tab.
export const CAPABILITIES_REQUEST = { op: "capabilities" } as const

export const supportsContainers = (
  ack: { ok?: boolean; capabilities?: unknown } | null,
): boolean =>
  Boolean(ack?.ok) &&
  Array.isArray(ack?.capabilities) &&
  ack.capabilities.includes("container")

export const CONTAINER_TOO_OLD =
  "the foxhop extension is too old to use containers — update it; nothing was opened"

// A --container flag value: trimmed, and undefined when empty.
export const containerFlag = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined
  return value.trim() || undefined
}

// The container `focus` uses: the flag when given (an empty one meaning the
// default container, for this call only), else the target's saved one.
export const focusContainer = (
  flag: unknown,
  saved: string | undefined,
): string | undefined =>
  typeof flag === "string" ? containerFlag(flag) : saved
