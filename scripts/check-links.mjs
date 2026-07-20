import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const documents = ["README.md", "docs/USER_GUIDE.md", "docs/PARAMETERS.md", "SPEC.md"];
const failures = [];
for (const document of documents) {
  const text = await readFile(document, "utf8");
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split("#")[0].split("?")[0];
    if (!target || /^(?:https?:|mailto:)/.test(target)) continue;
    const path = resolve(dirname(document), decodeURIComponent(target));
    try { await access(path); }
    catch { failures.push(`${document}: ${match[1]}`); }
  }
}
if (failures.length) {
  console.error(`リンク切れ:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`${documents.length}文書のローカルリンクを検証しました`);
}
