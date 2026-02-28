import { createOpencodeClient, type Session } from "@opencode-ai/sdk/v2/client"
import { For, Show, createMemo, createResource, createSignal, onMount } from "solid-js"
import { render } from "solid-js/web"
import "./styles.css"

const log = (...args: unknown[]) => console.info("[session-modal]", ...args)

const baseUrl = () => localStorage.getItem("session-modal.base-url") ?? "http://localhost:4096"

const isTauri = () => Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)

const trim = (value: string) => value.replace(/\/$/, "")

const authHeader = (username?: string | null, password?: string | null) => {
  if (!username || !password) return
  return `Basic ${btoa(`${username}:${password}`)}`
}

const client = (url: string, auth?: string, directory?: string) =>
  createOpencodeClient({
    baseUrl: trim(url),
    directory,
    throwOnError: true,
    headers: auth
      ? {
          Authorization: auth,
        }
      : undefined,
  })

const unique = <T,>(list: T[]) => Array.from(new Set(list))

const bySession = <T extends { sessionID: string }>(list: T[]) => {
  return list.reduce<Record<string, T[]>>((acc, item) => {
    const existing = acc[item.sessionID]
    if (existing) {
      existing.push(item)
      return acc
    }
    acc[item.sessionID] = [item]
    return acc
  }, {})
}

const rootSession = (session: Session) => !session.parentID && !session.time?.archived

const updatedAt = (session: Session) => session.time?.updated ?? session.time?.created ?? 0

type Connection = {
  baseUrl: string
  username?: string | null
  password?: string | null
  source: "manual" | "tauri"
}

type Diagnostics = {
  baseUrl: string
  source: "manual" | "tauri"
  hasAuth: boolean
  projects: number
  directories: number
  globalSessions: number
}

const App = () => {
  const [connection, setConnection] = createSignal<Connection>({
    baseUrl: baseUrl(),
    source: "manual",
  })
  const [diagnostics, setDiagnostics] = createSignal<Diagnostics>({
    baseUrl: connection().baseUrl,
    source: connection().source,
    hasAuth: false,
    projects: 0,
    directories: 0,
    globalSessions: 0,
  })

  onMount(() => {
    if (!isTauri()) {
      log("runtime:web", { baseUrl: connection().baseUrl })
      return
    }

    log("runtime:tauri", { message: "awaiting initialization" })
    void (async () => {
      const [{ Channel }, desktop] = await Promise.all([import("@tauri-apps/api/core"), import("./desktop-bindings")])

      const channel = new Channel()
      channel.onmessage = (step: unknown) => log("tauri:init-step", step)

      const ready = await desktop.awaitInitialization(channel as never)
      log("tauri:server-ready", {
        url: ready.url,
        hasUser: !!ready.username,
        hasPassword: !!ready.password,
        sidecar: ready.is_sidecar,
      })

      setConnection({
        baseUrl: ready.url,
        username: ready.username,
        password: ready.password,
        source: "tauri",
      })
    })().catch((error) => {
      log("tauri:init-error", error)
    })
  })

  const [state] = createResource(connection, async (value) => {
    const start = Date.now()
    const auth = authHeader(value.username, value.password)
    log("refresh:start", {
      baseUrl: value.baseUrl,
      source: value.source,
      hasAuth: !!auth,
    })

    const global = client(value.baseUrl, auth)
    const projects = await global.project.list().then((x) => x.data ?? [])
    log("projects:loaded", { count: projects.length })

    const globalSessions = await global.session.list({ limit: 500 }).then((x) => x.data ?? [])
    log("sessions:global", { count: globalSessions.length })

    const directories = unique(
      [...projects.map((project) => project.worktree), ...globalSessions.map((session) => session.directory)].filter(
        (directory) => !!directory,
      ),
    )
    setDiagnostics({
      baseUrl: value.baseUrl,
      source: value.source,
      hasAuth: !!auth,
      projects: projects.length,
      directories: directories.length,
      globalSessions: globalSessions.length,
    })
    log("directories:resolved", { count: directories.length })

    if (directories.length === 0) {
      return []
    }

    const rows = await Promise.all(
      directories.map(async (directory) => {
        const at = Date.now()
        const scoped = client(value.baseUrl, auth, directory)
        const [sessions, permissions, questions, statuses] = await Promise.all([
          scoped.session.list({ limit: 200 }).then((x) => x.data ?? []),
          scoped.permission.list().then((x) => x.data ?? []),
          scoped.question.list().then((x) => x.data ?? []),
          scoped.session.status().then((x) => x.data ?? {}),
        ])
        const permissionBySession = bySession(permissions.filter((item) => !!item.sessionID))
        const questionBySession = bySession(questions.filter((item) => !!item.sessionID))

        log("directory:loaded", {
          directory,
          sessions: sessions.length,
          permissions: permissions.length,
          questions: questions.length,
          elapsed: Date.now() - at,
        })

        return sessions.filter(rootSession).map((session) => {
          const permissionCount = permissionBySession[session.id]?.length ?? 0
          const questionCount = questionBySession[session.id]?.length ?? 0
          const requiresInput = permissionCount + questionCount > 0
          const status = statuses[session.id]?.type ?? "idle"
          const busy = status === "busy" || status === "retry"
          const priority = requiresInput ? 0 : busy ? 1 : 2
          return {
            id: session.id,
            directory,
            title: session.title || "Untitled session",
            updated: updatedAt(session),
            requiresInput,
            busy,
            permissionCount,
            questionCount,
            priority,
          }
        })
      }),
    )

    const sorted = rows
      .flat()
      .sort((a, b) => b.updated - a.updated)
      .sort((a, b) => a.priority - b.priority)

    log("refresh:done", {
      sessions: sorted.length,
      attention: sorted.filter((item) => item.requiresInput || item.busy).length,
      elapsed: Date.now() - start,
    })

    return sorted
  })

  const sessions = createMemo(() => state.latest ?? [])
  const attention = createMemo(() => sessions().filter((session) => session.requiresInput || session.busy))

  const openSession = (item: { directory: string; id: string }) => {
    const href = `opencode://open-session?directory=${encodeURIComponent(item.directory)}&id=${encodeURIComponent(item.id)}`
    log("session:open", { directory: item.directory, sessionID: item.id, href })
    window.location.assign(href)
  }

  const saveBaseUrl = (next: string) => {
    const value = next.trim()
    if (!value) return
    localStorage.setItem("session-modal.base-url", value)
    log("settings:base-url", { baseUrl: value })
    setConnection({
      baseUrl: value,
      source: "manual",
    })
  }

  return (
    <main class="shell">
      <header class="hero">
        <div>
          <p class="eyebrow">OpenCode</p>
          <h1>Session Modal</h1>
          <p class="subtitle">Cross-project active sessions with attention-first sorting.</p>
        </div>
        <form
          class="server"
          onSubmit={(event) => {
            event.preventDefault()
            const data = new FormData(event.currentTarget)
            const next = data.get("base")
            if (typeof next !== "string") return
            saveBaseUrl(next)
          }}
        >
          <label for="base">Server</label>
          <input id="base" name="base" value={connection().baseUrl} />
          <button type="submit">Reload</button>
        </form>
      </header>

      <section class="panel">
        <div class="panel-header">
          <h2>Needs attention</h2>
          <span>{attention().length}</span>
        </div>
        <p class="state">
          source={diagnostics().source} auth={diagnostics().hasAuth ? "yes" : "no"} projects={diagnostics().projects}{" "}
          dirs=
          {diagnostics().directories} sessions={diagnostics().globalSessions}
        </p>
        <Show when={!state.loading} fallback={<p class="state">Loading sessions...</p>}>
          <Show when={!state.error} fallback={<p class="state error">{String(state.error)}</p>}>
            <Show when={sessions().length > 0} fallback={<p class="state">No sessions found.</p>}>
              <ul class="list">
                <For each={sessions()}>
                  {(item) => (
                    <li>
                      <button class="row" onClick={() => openSession(item)}>
                        <span class={`dot ${item.requiresInput || item.busy ? "active" : "idle"}`} />
                        <span class="meta">
                          <span class="title">{item.title}</span>
                          <span class="path">{item.directory}</span>
                        </span>
                        <span class="badges">
                          <Show when={item.requiresInput}>
                            <span class="badge badge-warn">input {item.permissionCount + item.questionCount}</span>
                          </Show>
                          <Show when={item.busy}>
                            <span class="badge">running</span>
                          </Show>
                        </span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </Show>
          </Show>
        </Show>
      </section>
    </main>
  )
}

const root = document.getElementById("root")
if (root) render(() => <App />, root)
