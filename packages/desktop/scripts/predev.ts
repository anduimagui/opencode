import { $ } from "bun"

import { copyBinaryToSidecarFolder, getCurrentSidecar, windowsify } from "./utils"

function target() {
  const env = Bun.env.TAURI_ENV_TARGET_TRIPLE
  if (env) return env

  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin"
  }

  if (process.platform === "win32") {
    return "x86_64-pc-windows-msvc"
  }

  if (process.arch === "arm64") {
    return "aarch64-unknown-linux-gnu"
  }

  return "x86_64-unknown-linux-gnu"
}

const rustTarget = target()
const sidecarConfig = getCurrentSidecar(rustTarget)

const binaryPath = windowsify(`../opencode/dist/${sidecarConfig.ocBinary}/bin/opencode`)

await (sidecarConfig.ocBinary.includes("-baseline")
  ? $`cd ../opencode && bun run build --single --baseline --skip-install`
  : $`cd ../opencode && bun run build --single --skip-install`)

await copyBinaryToSidecarFolder(binaryPath, rustTarget)
