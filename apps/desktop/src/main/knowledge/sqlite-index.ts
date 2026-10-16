import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { KnowledgeChunk } from "./chunking.js";

interface SqliteSearchRow {
  readonly relative_path: string;
  readonly start_line: number;
  readonly end_line: number;
  readonly title_context: string;
  readonly text: string;
  readonly rank: number;
}

export interface SqliteKnowledgeHit {
  readonly relativePath: string;
  readonly titleContext: readonly string[];
  readonly startLine: number;
  readonly endLine: number;
  readonly score: number;
  readonly text: string;
}

const TOKEN_PATTERN = /[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*|[\u3400-\u9fff]+/gu;
const ENGLISH_STOP_WORDS = new Set([
  "a",
  "an",
  "at",
  "did",
  "is",
  "it",
  "of",
  "on",
  "the",
  "to",
  "was",
  "were",
  "what",
  "where",
  "which",
  "who",
]);

function createSchema(database: DatabaseSync): void {
  database.exec(`
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = FULL;
    CREATE TABLE metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    ) STRICT;
    CREATE VIRTUAL TABLE chunks USING fts5(
      chunk_id UNINDEXED,
      relative_path UNINDEXED,
      start_line UNINDEXED,
      end_line UNINDEXED,
      title_context,
      text,
      tokenize = 'trigram'
    );
  `);
}

function insertMetadata(
  database: DatabaseSync,
  projectId: string,
  indexVersion: string,
): void {
  const insert = database.prepare(
    "INSERT INTO metadata(key, value) VALUES (?, ?)",
  );
  insert.run("schema_version", "1");
  insert.run("project_id", projectId);
  insert.run("index_version", indexVersion);
}

function insertChunks(
  database: DatabaseSync,
  chunks: readonly KnowledgeChunk[],
): void {
  const insert = database.prepare(`
    INSERT INTO chunks(
      chunk_id,
      relative_path,
      start_line,
      end_line,
      title_context,
      text
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  for (const chunk of chunks) {
    insert.run(
      chunk.chunkId,
      chunk.relativePath,
      chunk.startLine,
      chunk.endLine,
      JSON.stringify(chunk.titleContext),
      chunk.text,
    );
  }
}

function metadataValue(database: DatabaseSync, key: string): string | null {
  const row = database
    .prepare("SELECT value FROM metadata WHERE key = ?")
    .get(key) as { readonly value?: unknown } | undefined;
  return typeof row?.value === "string" ? row.value : null;
}

function assertIdentity(
  database: DatabaseSync,
  projectId: string,
  indexVersion: string,
): void {
  if (
    metadataValue(database, "schema_version") !== "1" ||
    metadataValue(database, "project_id") !== projectId ||
    metadataValue(database, "index_version") !== indexVersion
  ) {
    throw new Error(
      "The SQLite knowledge index identity does not match its state.",
    );
  }
}

function queryTokens(query: string): readonly string[] {
  return [...query.matchAll(TOKEN_PATTERN)]
    .map((match) => match[0])
    .filter((token) => !ENGLISH_STOP_WORDS.has(token.toLocaleLowerCase()));
}

function ftsQuery(tokens: readonly string[]): string {
  return tokens
    .filter((token) => [...token].length >= 3)
    .map((token) => `"${token.replaceAll('"', '""')}"`)
    .join(" OR ");
}

function parseTitleContext(value: string): readonly string[] {
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    parsed.some((entry) => typeof entry !== "string")
  ) {
    throw new Error("The SQLite knowledge title context is invalid.");
  }
  return parsed;
}

function scoreFromRank(rank: number): number {
  const positive = Math.max(0, -rank);
  return Number((positive / (1 + positive)).toFixed(6));
}

async function syncDirectory(path: string): Promise<void> {
  try {
    const handle = await open(path, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch {
    // Directory fsync is unavailable on some supported platforms/filesystems.
  }
}

export async function buildSqliteKnowledgeIndex(options: {
  readonly databasePath: string;
  readonly projectId: string;
  readonly indexVersion: string;
  readonly chunks: readonly KnowledgeChunk[];
  readonly batchSize?: number;
  readonly afterBatch?: () => void | Promise<void>;
}): Promise<void> {
  const parent = dirname(options.databasePath);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const temporaryPath = join(
    parent,
    `.${basename(options.databasePath)}.${randomUUID()}.tmp`,
  );
  const database = new DatabaseSync(temporaryPath);
  try {
    createSchema(database);
    database.exec("BEGIN IMMEDIATE");
    insertMetadata(database, options.projectId, options.indexVersion);
    database.exec("COMMIT");
    const batchSize = options.batchSize ?? 250;
    for (let offset = 0; offset < options.chunks.length; offset += batchSize) {
      database.exec("BEGIN IMMEDIATE");
      try {
        insertChunks(
          database,
          options.chunks.slice(offset, offset + batchSize),
        );
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      await options.afterBatch?.();
    }
    database.exec("INSERT INTO chunks(chunks) VALUES ('optimize')");
    database.close();
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, options.databasePath);
    await syncDirectory(parent);
  } catch (error) {
    try {
      database.close();
    } catch {
      // The database may already have been closed before publication failed.
    }
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function replaceSqliteKnowledgeSource(options: {
  readonly databasePath: string;
  readonly projectId: string;
  readonly previousIndexVersion: string;
  readonly nextIndexVersion: string;
  readonly relativePath: string;
  readonly chunks: readonly KnowledgeChunk[];
}): void {
  const database = new DatabaseSync(options.databasePath);
  try {
    assertIdentity(database, options.projectId, options.previousIndexVersion);
    database.exec("BEGIN IMMEDIATE");
    try {
      database
        .prepare("DELETE FROM chunks WHERE relative_path = ?")
        .run(options.relativePath);
      insertChunks(database, options.chunks);
      database
        .prepare("UPDATE metadata SET value = ? WHERE key = 'index_version'")
        .run(options.nextIndexVersion);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }
}

export function verifySqliteKnowledgeIndex(options: {
  readonly databasePath: string;
  readonly projectId: string;
  readonly indexVersion: string;
}): void {
  const database = new DatabaseSync(options.databasePath, { readOnly: true });
  try {
    assertIdentity(database, options.projectId, options.indexVersion);
    database.prepare("SELECT count(*) AS count FROM chunks").get();
  } finally {
    database.close();
  }
}

export function searchSqliteKnowledgeIndex(options: {
  readonly databasePath: string;
  readonly projectId: string;
  readonly indexVersion: string;
  readonly query: string;
  readonly limit: number;
}): readonly SqliteKnowledgeHit[] {
  const tokens = queryTokens(options.query);
  if (tokens.length === 0) return [];
  const query = ftsQuery(tokens);
  const database = new DatabaseSync(options.databasePath, { readOnly: true });
  try {
    assertIdentity(database, options.projectId, options.indexVersion);
    const rows =
      query.length > 0
        ? (database
            .prepare(
              `
          SELECT
            relative_path,
            CAST(start_line AS INTEGER) AS start_line,
            CAST(end_line AS INTEGER) AS end_line,
            title_context,
            text,
            bm25(chunks, 0, 0, 0, 0, 2.0, 1.0) AS rank
          FROM chunks
          WHERE chunks MATCH ?
          ORDER BY rank, relative_path, start_line
          LIMIT ?
        `,
            )
            .all(query, options.limit) as unknown as readonly SqliteSearchRow[])
        : searchShortTokens(database, tokens, options.limit);
    return rows.map((row) => ({
      relativePath: row.relative_path,
      titleContext: parseTitleContext(row.title_context),
      startLine: row.start_line,
      endLine: row.end_line,
      score: scoreFromRank(row.rank),
      text: row.text,
    }));
  } finally {
    database.close();
  }
}

function searchShortTokens(
  database: DatabaseSync,
  tokens: readonly string[],
  limit: number,
): readonly SqliteSearchRow[] {
  const clauses = tokens.map(() => "(text LIKE ? OR title_context LIKE ?)");
  const parameters = tokens.flatMap((token) => [`%${token}%`, `%${token}%`]);
  return database
    .prepare(
      `
        SELECT
          relative_path,
          CAST(start_line AS INTEGER) AS start_line,
          CAST(end_line AS INTEGER) AS end_line,
          title_context,
          text,
          -1.0 AS rank
        FROM chunks
        WHERE ${clauses.join(" OR ")}
        ORDER BY relative_path, start_line
        LIMIT ?
      `,
    )
    .all(...parameters, limit) as unknown as readonly SqliteSearchRow[];
}
