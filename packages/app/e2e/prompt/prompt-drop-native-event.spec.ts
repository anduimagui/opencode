import { test, expect } from "../fixtures"
import { promptSelector } from "../selectors"

test("desktop native drop event inserts a file pill", async ({ page, gotoSession }) => {
  await gotoSession()

  const prompt = page.locator(promptSelector)
  await prompt.click()

  const path = process.platform === "win32" ? "C:\\opencode-e2e-native-drop.ts" : "/tmp/opencode-e2e-native-drop.ts"

  await page.evaluate((value) => {
    window.dispatchEvent(new CustomEvent("opencode:native-file-drop", { detail: { paths: [value] } }))
  }, path)

  const pill = page.locator(`${promptSelector} [data-type="file"]`).first()
  await expect(pill).toBeVisible()
  await expect(pill).toHaveAttribute("data-path", path)
})
