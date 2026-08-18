import { cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"

const require = createRequire(import.meta.url)
const root = path.resolve(import.meta.dirname, "..")
const source = path.resolve(require("electron") as string, "../../..")
const dist = path.join(root, "node_modules", ".cache", "electron-dist")
const app = path.join(dist, "Electron.app")
const next = path.join(root, "node_modules", ".cache", "electron-dist.next")
const fingerprint = `${(require("electron/package.json") as { version: string }).version}:ai.opencode.desktop.dev:3`

if ((await readFile(path.join(app, "Contents", ".opencode-fingerprint"), "utf8").catch(() => "")) !== fingerprint) {
  await mkdir(path.dirname(dist), { recursive: true })
  await rm(next, { force: true, recursive: true })
  await cp(source, path.join(next, "Electron.app"), { recursive: true })

  const plists = [
    ["", "ai.opencode.desktop.dev"],
    [" (GPU)", "ai.opencode.desktop.dev.helper.gpu"],
    [" (Plugin)", "ai.opencode.desktop.dev.helper.plugin"],
    [" (Renderer)", "ai.opencode.desktop.dev.helper.renderer"],
  ] as const

  for (const [name, id] of plists) {
    const plist = name
      ? path.join(
          next,
          "Electron.app",
          "Contents",
          "Frameworks",
          `Electron Helper${name}.app`,
          "Contents",
          "Info.plist",
        )
      : path.join(next, "Electron.app", "Contents", "Info.plist")
    const result = Bun.spawnSync(["plutil", "-replace", "CFBundleIdentifier", "-string", id, plist])
    if (result.exitCode) throw new Error(result.stderr.toString())
  }

  const info = path.join(next, "Electron.app", "Contents", "Info.plist")
  const protocol = Bun.spawnSync([
    "plutil",
    "-replace",
    "CFBundleURLTypes",
    "-json",
    JSON.stringify([{ CFBundleURLName: "ai.opencode.desktop.dev", CFBundleURLSchemes: ["opencode"] }]),
    info,
  ])
  if (protocol.exitCode) throw new Error(protocol.stderr.toString())

  const embedded = path.join(next, "Electron.app", "Contents", "Resources", "app")
  await mkdir(embedded, { recursive: true })
  await writeFile(
    path.join(embedded, "package.json"),
    JSON.stringify({
      main: "index.js",
      name: "@opencode-ai/desktop",
      type: "module",
    }),
  )
  await writeFile(
    path.join(embedded, "index.js"),
    `import ${JSON.stringify(path.join(root, "out", "main", "index.js"))}\n`,
  )
  await writeFile(path.join(next, "Electron.app", "Contents", ".opencode-fingerprint"), fingerprint)
  const sign = Bun.spawnSync(["codesign", "--force", "--deep", "--sign", "-", path.join(next, "Electron.app")])
  if (sign.exitCode) throw new Error(sign.stderr.toString())
  await rm(dist, { force: true, recursive: true })
  await rename(next, dist)
}

const child = Bun.spawn(["bun", "x", "electron-vite", "dev"], {
  cwd: root,
  env: {
    ...process.env,
    ELECTRON_EXEC_PATH: path.join(app, "Contents", "MacOS", "Electron"),
  },
  stderr: "inherit",
  stdin: "inherit",
  stdout: "inherit",
})

process.exit(await child.exited)
