export const deepLinkEvent = "opencode:deep-link"

export type DeepLinkAction =
  | { type: "open-project"; directory: string }
  | { type: "open-session"; directory: string; sessionID: string }

const parseUrl = (input: string) => {
  if (!input.startsWith("opencode://")) return
  if (typeof URL.canParse === "function" && !URL.canParse(input)) return
  try {
    return new URL(input)
  } catch {
    return
  }
}

export const parseDeepLink = (input: string) => {
  const url = parseUrl(input)
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

export const parseNewSessionDeepLink = (input: string) => {
  const url = parseUrl(input)
  if (!url) return
  if (url.hostname !== "new-session") return
  const directory = url.searchParams.get("directory")
  if (!directory) return
  const prompt = url.searchParams.get("prompt") || undefined
  if (!prompt) return { directory }
  return { directory, prompt }
}

export const collectNewSessionDeepLinks = (urls: string[]) =>
  urls.reduce<Array<{ directory: string; prompt?: string }>>((list, url) => {
    const link = parseNewSessionDeepLink(url)
    if (link) list.push(link)
    return list
  }, [])

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
