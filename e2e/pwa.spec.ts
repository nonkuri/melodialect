import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("melodialect.onboarding.v0.8", "done"));
});

test("manifest, icons and service worker resolve under the deployment subpath", async ({ page, request }) => {
  await page.goto("./");
  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(manifestHref).toBeTruthy();
  const manifestResponse = await request.get(new URL(manifestHref!, page.url()).toString());
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json();
  expect(manifest.start_url).toBe("./");
  for (const icon of manifest.icons) {
    const response = await request.get(new URL(icon.src, manifestResponse.url()).toString());
    expect(response.ok(), icon.src).toBeTruthy();
  }
  const ready = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return Boolean(registration.active);
  });
  expect(ready).toBeTruthy();
});

test("reopens offline after the first successful load", async ({ page, context, browserName }) => {
  test.skip(browserName !== "chromium", "One engine is sufficient for the offline cache lifecycle; compatibility runs separately.");
  await page.goto("./");
  const prepared = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await Promise.race([
        new Promise<void>((resolve) => navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true })),
        new Promise<void>((resolve) => window.setTimeout(resolve, 5_000)),
      ]);
    }
    const shell = new URL("index.html", registration.scope).toString();
    return {
      controlled: Boolean(navigator.serviceWorker.controller),
      shellCached: Boolean(await caches.match(shell)),
    };
  });
  expect(prepared).toEqual({ controlled: true, shellCached: true });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: /Melodialect/ })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "オフライン" })).toBeVisible();
});

test("site-data deletion starts clean and does not crash", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "Storage semantics are covered once; fresh contexts in the browser matrix cover isolation.");
  await page.goto("./");
  await page.getByLabel("曲名").fill("削除確認用");
  await page.waitForTimeout(600);
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    for (const name of await caches.keys()) await caches.delete(name);
    const databases = await indexedDB.databases?.() ?? [];
    await Promise.all(databases.map((database) => database.name && new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(database.name!);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    })));
  });
  await page.reload();
  await expect(page.getByLabel("曲名")).toHaveValue("新しい曲");
});
