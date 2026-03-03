import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"

test("dropping a desktop file object inserts a file pill", async ({ page, gotoSession }) => {
  await gotoSession()

  const prompt = page.locator(promptSelector)
  await prompt.click()

  const path = process.platform === "win32" ? "C:\\opencode-e2e-drop-desktop.txt" : "/tmp/opencode-e2e-drop-desktop.txt"

  await page.evaluate(() => {
    ;(window as unknown as { __promptDropDebug?: unknown[] }).__promptDropDebug = []
    const record = (event: DragEvent, stage: string) => {
      const dataTransfer = event.dataTransfer
      const files = Array.from(dataTransfer?.files ?? []).map((file) => ({
        name: file.name,
        type: file.type,
        size: file.size,
        path: (file as File & { path?: string }).path ?? null,
      }))
      ;(window as unknown as { __promptDropDebug?: unknown[] }).__promptDropDebug?.push({
        stage,
        types: dataTransfer?.types ?? [],
        files,
      })
    }
    document.addEventListener("dragover", (event) => record(event, "dragover"), { capture: true, once: true })
    document.addEventListener("drop", (event) => record(event, "drop"), { capture: true, once: true })
  })

  const dt = await page.evaluateHandle((value) => {
    const dt = new DataTransfer()
    const file = new File(["export const x = 1\n"], "drop.ts", { type: "text/plain" })
    Object.defineProperty(file, "path", {
      value,
      configurable: true,
    })
    dt.items.add(file)
    dt.setData("text/plain", value)
    return dt
  }, path)

  await page.dispatchEvent("body", "dragover", { dataTransfer: dt })
  await page.dispatchEvent("body", "drop", { dataTransfer: dt })

  const pill = page.locator(`${promptSelector} [data-type="file"]`).first()
  await expect(pill).toBeVisible()
  await expect(pill).toHaveAttribute("data-path", path)

  const logs = await page.evaluate(
    () => (window as unknown as { __promptDropDebug?: unknown[] }).__promptDropDebug ?? [],
  )
  console.log("prompt-drop-debug", JSON.stringify(logs, null, 2))
})
