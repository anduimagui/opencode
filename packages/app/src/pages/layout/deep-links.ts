export const deepLinkEvent = "opencode:deep-link"

export type DeepLinkAction =
  | { type: "open-project"; directory: string }
  | { type: "open-session"; directory: string; sessionID: string }

export const parseDeepLink = (input: string): DeepLinkAction | undefined => {
  if (!input.startsWith("opencode://")) return
  if (typeof URL.canParse === "function" && !URL.canParse(input)) return
  const url = (() => {
    try {
      return new URL(input)
    } catch {
      return undefined
    }
  })()
  if (!url) return

  if (url.hostname === "open-project") {
    const directory = url.searchParams.get("directory")
    if (!directory) return
    return {
      type: "open-project",
      directory,
    }
  }

  if (url.hostname !== "open-session") return
  const directory = url.searchParams.get("directory")
  const sessionID = url.searchParams.get("id") ?? url.searchParams.get("sessionID")
  if (!directory || !sessionID) return
  return {
    type: "open-session",
    directory,
    sessionID,
  }
}

export const collectDeepLinkActions = (urls: string[]) =>
  urls.map(parseDeepLink).filter((action): action is DeepLinkAction => !!action)

type OpenCodeWindow = Window & {
  __OPENCODE__?: {
    deepLinks?: string[]
  }
}

export const drainPendingDeepLinks = (target: OpenCodeWindow) => {
  const pending = target.__OPENCODE__?.deepLinks ?? []
  if (pending.length === 0) return []
  if (target.__OPENCODE__) target.__OPENCODE__.deepLinks = []
  return pending
}
