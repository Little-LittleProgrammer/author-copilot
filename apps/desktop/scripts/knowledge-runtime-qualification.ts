import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const electronExecutable: unknown = require("electron");
if (typeof electronExecutable !== "string") {
  throw new TypeError(
    "The Electron package did not resolve to an executable path",
  );
}

const qualification = String.raw`
  const { DatabaseSync } = require("node:sqlite");
  const database = new DatabaseSync(":memory:");
  database.exec("CREATE VIRTUAL TABLE chunks USING fts5(text, tokenize='trigram')");
  const insert = database.prepare("INSERT INTO chunks(text) VALUES (?)");
  insert.run("北站第三站台的铜钥匙");
  insert.run("brass compass beneath the observatory stair");
  const chinese = database.prepare("SELECT count(*) AS count FROM chunks WHERE chunks MATCH ?").get('"第三站台"');
  const english = database.prepare("SELECT count(*) AS count FROM chunks WHERE chunks MATCH ?").get('"observatory"');
  if (Number(chinese.count) !== 1 || Number(english.count) !== 1) {
    throw new Error("Electron SQLite FTS5 trigram retrieval returned unexpected results");
  }
  database.close();
  console.log(JSON.stringify({
    status: "passed",
    electron: process.versions.electron,
    node: process.versions.node,
    sqlite: process.versions.sqlite,
    platform: process.platform,
    arch: process.arch,
    fts5: true,
    tokenizer: "trigram"
  }));
`;

const result = spawnSync(electronExecutable, ["-e", qualification], {
  encoding: "utf8",
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  maxBuffer: 1024 * 1024,
  timeout: 30_000,
});

if (result.error !== undefined) throw result.error;
if (result.status !== 0) {
  throw new Error(
    `Electron Knowledge runtime qualification failed (${String(result.status)}): ${result.stderr}`,
  );
}
process.stdout.write(result.stdout);
