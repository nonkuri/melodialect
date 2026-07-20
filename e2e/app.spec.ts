import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("melodialect.onboarding.v0.8", "done"));
});

test("loads from the configured base path and completes the main workflow", async ({ page }) => {
  const failures: string[] = [];
  page.on("response", (response) => {
    if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`);
  });
  page.on("pageerror", (error) => failures.push(error.message));
  await page.goto("./");
  await expect(page.getByRole("heading", { name: /Melodialect/ })).toBeVisible();
  await page.getByLabel("目的から始める").selectOption("first-song");
  await page.getByRole("button", { name: /全体生成/ }).click();
  await expect(page.getByRole("button", { name: /生成済み/ })).toBeVisible();
  const supportsAudio = await page.evaluate(() => typeof AudioContext !== "undefined");
  await page.getByRole("button", { name: "▶ 再生" }).click();
  if (supportsAudio) {
    await expect(page.getByRole("button", { name: "Ⅱ 一時停止" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "■ 停止" }).click();
  } else {
    await expect(page.getByRole("button", { name: "▶ 再生" })).toBeVisible();
  }
  expect(failures).toEqual([]);
});

test("exposes keyboard focus and accessible names for primary controls", async ({ page }) => {
  await page.goto("./");
  const unnamed = await page.locator("button:not([disabled]), input:not([type=hidden]), select, textarea, a[href]").evaluateAll((elements) =>
    elements.filter((element) => {
      const html = element as HTMLElement;
      if (html.offsetParent === null) return false;
      const labelled = element.getAttribute("aria-label") || element.getAttribute("aria-labelledby") ||
        (element instanceof HTMLInputElement && element.labels?.length) ||
        (element instanceof HTMLSelectElement && element.labels?.length) ||
        (element instanceof HTMLTextAreaElement && element.labels?.length) || html.textContent?.trim() || element.getAttribute("title");
      return !labelled;
    }).map((element) => element.outerHTML));
  expect(unnamed).toEqual([]);
  await page.keyboard.press("Tab");
  const focus = page.locator(":focus");
  await expect(focus).toBeVisible();
  const outline = await focus.evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(outline).not.toBe("none");
});

test("creates, validates, previews, saves and selects a dialect without editing JSON", async ({ page }) => {
  await page.goto("./");
  await page.getByRole("button", { name: "管理", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "ダイアレクトを管理" });
  await dialog.getByRole("button", { name: "複製して新規作成" }).click();
  const id = await dialog.getByLabel("ID（英小文字・数字・ハイフン）").inputValue();
  await dialog.getByLabel("名前").fill("E2E ダイアレクト");
  await dialog.getByLabel("テンポ").fill("300");
  await expect(dialog.getByRole("alert").filter({ hasText: "40〜240の範囲で指定してください" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "試し生成" })).toBeDisabled();
  await dialog.getByLabel("テンポ").fill("110");
  await dialog.getByRole("button", { name: "試し生成" }).click();
  await expect(dialog.getByText("試し生成結果")).toBeVisible();
  await dialog.getByRole("button", { name: "端末へ保存" }).click();
  await expect(dialog.getByText("E2E ダイアレクト を端末へ保存しました。")).toBeVisible();
  await dialog.getByRole("button", { name: "この曲で使う" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("ダイアレクト", { exact: true })).toHaveValue(id);
});

test("renders a WAV through the browser audio pipeline", async ({ page }) => {
  await page.goto("./?qa=1");
  const supportsOfflineAudio = await page.evaluate(() => typeof OfflineAudioContext !== "undefined");
  test.skip(!supportsOfflineAudio, "The Playwright WebKit port does not expose Web Audio; Safari coverage uses the same application path.");
  const result = await page.evaluate(async () => window.__MELODIALECT_QA__!.renderWavSmokeTest());
  expect(result.header).toBe("RIFF/WAVE");
  expect(result.bytes).toBeGreaterThan(44);
  expect(result.progressUpdates).toBeGreaterThanOrEqual(3);
  expect(result.elapsedMs).toBeLessThan(30_000);
});
