import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { List } from "@opencode-ai/ui/list"
import { Spinner } from "@opencode-ai/ui/spinner"
import { base64Encode } from "@opencode-ai/util/encode"
import { getDirectory, getFilename } from "@opencode-ai/util/path"
import { useNavigate } from "@solidjs/router"
import { createMemo, Match, type Accessor, Switch } from "solid-js"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { useLanguage } from "@/context/language"
import { useNotification } from "@/context/notification"
import { usePermission } from "@/context/permission"
import { getRelativeTime } from "@/utils/time"
import { sessionPermissionRequest } from "@/pages/session/composer/session-request-tree"

type Entry = {
  id: string
  title: string
  description: string
  directory: string
  sessionID: string
  archived?: number
  updated?: number
}

function SessionStatus(props: {
  isWorking: Accessor<boolean>
  hasPermissions: Accessor<boolean>
  hasError: Accessor<boolean>
  unseenCount: Accessor<number>
}) {
  return (
    <div class="shrink-0 size-6 flex items-center justify-center" style={{ color: "var(--icon-interactive-base)" }}>
      <Switch fallback={<div class="text-icon-weak">-</div>}>
        <Match when={props.isWorking()}>
          <Spinner class="size-[15px]" />
        </Match>
        <Match when={props.hasPermissions()}>
          <div class="size-1.5 rounded-full bg-surface-warning-strong" />
        </Match>
        <Match when={props.hasError()}>
          <div class="size-1.5 rounded-full bg-text-diff-delete-base" />
        </Match>
        <Match when={props.unseenCount() > 0}>
          <div class="size-1.5 rounded-full bg-text-interactive-base" />
        </Match>
      </Switch>
    </div>
  )
}

function SessionEntryRow(props: { item: Entry }) {
  const language = useLanguage()
  const notification = useNotification()
  const permission = usePermission()
  const globalSync = useGlobalSync()
  const [store] = globalSync.child(props.item.directory, { bootstrap: false })
  const hasPermissions = createMemo(() => {
    return !!sessionPermissionRequest(store.session, store.permission, props.item.sessionID, (item) => {
      return !permission.autoResponds(item, props.item.directory)
    })
  })
  const isWorking = createMemo(() => {
    if (hasPermissions()) return false
    const status = store.session_status[props.item.sessionID]
    return status?.type === "busy" || status?.type === "retry"
  })
  const hasError = createMemo(() => notification.session.unseenHasError(props.item.sessionID))
  const unseenCount = createMemo(() => notification.session.unseenCount(props.item.sessionID))
  const showLatest = createMemo(() => isWorking() || unseenCount() > 0 || hasPermissions())
  const latest = createMemo(() => {
    const messages = store.message[props.item.sessionID]
    if (!messages) return
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      if (message.role !== "assistant") continue
      const text = extractText(store.part[message.id] ?? [])
      if (text) return text
    }
  })

  return (
    <div class="w-full flex items-center justify-between rounded-md pl-1">
      <div class="flex items-center gap-x-3 grow min-w-0">
        <SessionStatus
          isWorking={isWorking}
          hasPermissions={hasPermissions}
          hasError={hasError}
          unseenCount={unseenCount}
        />
        <div class="min-w-0 grow">
          <div class="flex items-center gap-2 min-w-0">
            <span class="text-14-regular text-text-strong truncate" classList={{ "opacity-70": !!props.item.archived }}>
              {props.item.title}
            </span>
            <span class="text-14-regular text-text-weak truncate" classList={{ "opacity-70": !!props.item.archived }}>
              {props.item.description}
            </span>
          </div>
          <Match when={showLatest() && latest()}>
            <div class="text-12-regular text-text-weak truncate pr-4 mt-0.5">{latest()}</div>
          </Match>
        </div>
      </div>
      <span class="text-12-regular text-text-weak whitespace-nowrap ml-2">
        {props.item.updated ? getRelativeTime(new Date(props.item.updated).toISOString(), language.t) : ""}
      </span>
    </div>
  )
}

function extractText(
  parts: Array<{ type?: string; text?: string; synthetic?: boolean; ignored?: boolean } | undefined>,
) {
  for (const part of parts) {
    if (!part || part.type !== "text") continue
    if (part.synthetic || part.ignored) continue
    const value = part.text?.trim()
    if (value) return value
  }
}

export function DialogSelectSession() {
  const dialog = useDialog()
  const navigate = useNavigate()
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()
  const homedir = createMemo(() => globalSync.data.path.home)

  const state: {
    inflight: Promise<Entry[]> | undefined
    cached: Entry[] | undefined
  } = {
    inflight: undefined,
    cached: undefined,
  }

  const load = () => {
    if (state.cached) return state.cached
    if (state.inflight) return state.inflight

    state.inflight = globalSDK.client.session
      .list({ roots: true, limit: 500 })
      .then((x) => {
        const home = homedir()
        const next = (x.data ?? [])
          .filter((session) => !!session?.id && !!session.directory)
          .map((session) => {
            const path = home ? session.directory.replace(home, "~") : session.directory
            const directory = getFilename(session.directory)
            const parent = getFilename(getDirectory(session.directory))
            const description = parent && parent !== "/" ? `${parent}/${directory}` : directory || path
            return {
              id: `${session.directory}:${session.id}`,
              title: session.title ?? language.t("command.session.new"),
              description,
              directory: session.directory,
              sessionID: session.id,
              archived: session.time?.archived,
              updated: session.time?.updated,
            }
          })
          .sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0))
        state.cached = next
        return next
      })
      .catch(() => [] as Entry[])
      .finally(() => {
        state.inflight = undefined
      })

    return state.inflight
  }

  const items = async (text: string) => {
    const query = text.trim().toLowerCase()
    const filter = (items: Entry[]) => {
      if (!query) return items.slice(0, 100)
      return items.filter((item) => {
        const title = item.title.toLowerCase()
        const description = item.description.toLowerCase()
        const directory = item.directory.toLowerCase()
        return title.includes(query) || description.includes(query) || directory.includes(query)
      })
    }

    const result = load()
    if (Array.isArray(result)) return filter(result)
    return result.then(filter)
  }

  const onSelect = (item: Entry | undefined) => {
    if (!item) return
    dialog.close()
    navigate(`/${base64Encode(item.directory)}/session/${item.sessionID}`)
  }

  return (
    <Dialog class="pt-3 pb-0 !max-h-[480px]" transition>
      <List
        search={{
          placeholder: language.t("palette.search.sessions.placeholder"),
          autofocus: true,
          hideIcon: true,
        }}
        emptyMessage={language.t("palette.empty")}
        loadingMessage={language.t("common.loading")}
        items={items}
        key={(item) => item.id}
        filterKeys={["title", "description"]}
        onSelect={onSelect}
      >
        {(item) => <SessionEntryRow item={item} />}
      </List>
    </Dialog>
  )
}
