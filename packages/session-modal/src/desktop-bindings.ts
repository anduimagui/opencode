import { invoke as tauriInvoke, type Channel } from "@tauri-apps/api/core"

export type ServerReadyData = {
  url: string
  username: string | null
  password: string | null
  is_sidecar: boolean
}

export const awaitInitialization = (events: Channel) => tauriInvoke<ServerReadyData>("await_initialization", { events })
