import { readdir, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import packageJson from "./package.json" with { type: "json" };

function normalizeBase(value: string): string {
  const withLeading = value.startsWith("/") ? value : `/${value}`;
  return withLeading.endsWith("/") ? withLeading : `${withLeading}/`;
}

async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  }));
  return nested.flat();
}

/** Generate a precache list after Vite has emitted hashed assets and copied public files. */
function offlineServiceWorker(buildId: string): Plugin {
  let outputDirectory = "dist";
  return {
    name: "melodialect-offline-service-worker",
    apply: "build",
    configResolved(config) {
      outputDirectory = config.build.outDir;
    },
    async closeBundle() {
      const files = (await listFiles(outputDirectory))
        .map((path) => relative(outputDirectory, path).split(sep).join("/"))
        .filter((path) => path !== "sw.js" && !path.endsWith(".map") && !path.startsWith("audio-packs/"))
        .sort()
        .map((path) => `./${path}`);
      const source = `/* Melodialect ${packageJson.version} (${buildId}) */
const CACHE_NAME = ${JSON.stringify(`melodialect-app-${buildId}`)};
const CACHE_PREFIX = "melodialect-app-";
const PRECACHE = ${JSON.stringify(files, null, 2)};
const SHELL_URL = new URL("index.html", self.registration.scope).toString();
const OPTIONAL_AUDIO_PREFIX = new URL("audio-packs/", self.registration.scope).toString();

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      await Promise.all(PRECACHE.map(async (url) => {
        const absoluteUrl = new URL(url.startsWith("./") ? url.slice(2) : url, self.registration.scope).toString();
        const response = await fetch(absoluteUrl, { cache: "reload" });
        if (!response.ok) throw new Error(url + ": " + response.status);
        await cache.put(absoluteUrl, response);
      }));
    } catch (error) {
      await caches.delete(CACHE_NAME);
      throw error;
    }
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Optional SoundFont packs are persisted in OPFS after an explicit user action.
  // Do not duplicate them in CacheStorage or make app updates redownload them.
  if (url.toString().startsWith(OPTIONAL_AUDIO_PREFIX)) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (!response.ok) throw new Error("Navigation failed: " + response.status);
        const cache = await caches.open(CACHE_NAME);
        await cache.put(SHELL_URL, response.clone());
        return response;
      } catch {
        return (await caches.match(SHELL_URL, { ignoreVary: true })) ?? Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreVary: true });
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  })());
});
`;
      await writeFile(join(outputDirectory, "sw.js"), source, "utf8");
    },
  };
}

export default defineConfig(() => {
  const repository = process.env.GITHUB_REPOSITORY?.split("/").pop();
  const base = normalizeBase(process.env.VITE_BASE_PATH ??
    (process.env.GITHUB_ACTIONS === "true" && repository ? `/${repository}/` : "/"));
  const buildId = process.env.VITE_BUILD_ID ?? process.env.GITHUB_SHA?.slice(0, 12) ?? packageJson.version;
  return {
    base,
    define: {
      __APP_VERSION__: JSON.stringify(packageJson.version),
      __BUILD_ID__: JSON.stringify(buildId),
    },
    plugins: [react(), offlineServiceWorker(buildId)],
    server: {
      // preview 環境は PORT があれば従い、それ以外は Vite の空きポートを使う。
      port: process.env.PORT ? Number(process.env.PORT) : undefined,
    },
  };
});
