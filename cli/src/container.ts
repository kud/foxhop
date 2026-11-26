// The container a request asked for, and whether the extension honoured it.
// An extension predating containers ignores the field and answers as usual,
// so the tab lands in the default container; only a container-aware one
// echoes the container back in its ack.
export const containerIgnored = (
  request: { container?: string },
  ack: { ok?: boolean; action?: string; container?: string } | null,
): boolean =>
  Boolean(request.container) &&
  Boolean(ack?.ok) &&
  ack?.action !== "not-found" &&
  !ack?.container

export const CONTAINER_TOO_OLD =
  "the foxhop extension is too old to use containers — update it; the tab was not opened in the container"

// A --container flag value: trimmed, and undefined when empty.
export const containerFlag = (value: unknown): string | undefined => {
  if (typeof value !== "string") return undefined
  return value.trim() || undefined
}
