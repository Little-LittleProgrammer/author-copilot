import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";

const STORE_SCHEMA_VERSION = 1;
const MAX_USERNAME_LENGTH = 256;
const MAX_SECRET_LENGTH = 16 * 1024;

export type CredentialStoreErrorCode =
  | "encryption_unavailable"
  | "invalid_credential"
  | "invalid_origin"
  | "invalid_store";

export class CredentialStoreError extends Error {
  public constructor(
    public readonly code: CredentialStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CredentialStoreError";
  }
}

export interface CredentialEncryption {
  readonly isAvailable: () => boolean;
  readonly encrypt: (plaintext: string) => Buffer;
  readonly decrypt: (ciphertext: Buffer) => string;
}

export interface HttpsCredential {
  readonly origin: string;
  readonly username: string;
  readonly secret: string;
}

export interface HttpsCredentialStatus {
  readonly configured: boolean;
  readonly origin: string;
  readonly username: string | null;
  readonly updatedAt: string | null;
}

interface StoredCredential {
  readonly origin: string;
  readonly username: string;
  readonly encryptedSecret: string;
  readonly updatedAt: string;
}

interface CredentialStoreFile {
  readonly schemaVersion: typeof STORE_SCHEMA_VERSION;
  readonly entries: Readonly<Record<string, StoredCredential>>;
}

interface SecureCredentialStoreOptions {
  readonly filePath: string;
  readonly encryption: CredentialEncryption;
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function credentialKey(origin: string): string {
  return createHash("sha256").update(origin).digest("hex");
}

function assertCredentialText(
  value: string,
  name: string,
  maximumLength: number,
): void {
  if (
    value.length === 0 ||
    value.length > maximumLength ||
    value.includes("\0") ||
    value.includes("\r") ||
    value.includes("\n")
  ) {
    throw new CredentialStoreError(
      "invalid_credential",
      `The HTTPS credential ${name} is invalid.`,
    );
  }
}

function parseStoredCredential(value: unknown): StoredCredential {
  if (typeof value !== "object" || value === null) {
    throw new CredentialStoreError(
      "invalid_store",
      "The credential store is invalid.",
    );
  }
  const entry = value as Record<string, unknown>;
  if (
    typeof entry.origin !== "string" ||
    normalizeHttpsOrigin(entry.origin) !== entry.origin ||
    typeof entry.username !== "string" ||
    entry.username.length === 0 ||
    typeof entry.encryptedSecret !== "string" ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(entry.encryptedSecret) ||
    typeof entry.updatedAt !== "string" ||
    Number.isNaN(Date.parse(entry.updatedAt))
  ) {
    throw new CredentialStoreError(
      "invalid_store",
      "The credential store entry is invalid.",
    );
  }
  return {
    origin: entry.origin,
    username: entry.username,
    encryptedSecret: entry.encryptedSecret,
    updatedAt: entry.updatedAt,
  };
}

function parseStore(contents: string): CredentialStoreFile {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new CredentialStoreError(
      "invalid_store",
      "The credential store is not valid JSON.",
    );
  }
  if (typeof value !== "object" || value === null) {
    throw new CredentialStoreError(
      "invalid_store",
      "The credential store is invalid.",
    );
  }
  const input = value as Record<string, unknown>;
  if (
    input.schemaVersion !== STORE_SCHEMA_VERSION ||
    typeof input.entries !== "object" ||
    input.entries === null ||
    Array.isArray(input.entries)
  ) {
    throw new CredentialStoreError(
      "invalid_store",
      "The credential store schema is invalid.",
    );
  }
  const entries = Object.fromEntries(
    Object.entries(input.entries).map(([key, entry]) => {
      const parsed = parseStoredCredential(entry);
      if (key !== credentialKey(parsed.origin)) {
        throw new CredentialStoreError(
          "invalid_store",
          "The credential store key is invalid.",
        );
      }
      return [key, parsed];
    }),
  );
  return { schemaVersion: STORE_SCHEMA_VERSION, entries };
}

export function normalizeHttpsOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CredentialStoreError(
      "invalid_origin",
      "The credential origin must be a valid HTTPS origin.",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.pathname !== "/" ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new CredentialStoreError(
      "invalid_origin",
      "The credential origin must contain only an HTTPS scheme, host, and optional port.",
    );
  }
  return url.origin;
}

export class SecureCredentialStore {
  private queue: Promise<void> = Promise.resolve();

  public constructor(private readonly options: SecureCredentialStoreOptions) {}

  public setHttpsCredential(credential: HttpsCredential): Promise<void> {
    return this.exclusive(async () => {
      this.assertEncryptionAvailable();
      const origin = normalizeHttpsOrigin(credential.origin);
      assertCredentialText(
        credential.username,
        "username",
        MAX_USERNAME_LENGTH,
      );
      assertCredentialText(credential.secret, "secret", MAX_SECRET_LENGTH);
      const store = await this.load();
      const entry: StoredCredential = {
        origin,
        username: credential.username,
        encryptedSecret: this.options.encryption
          .encrypt(credential.secret)
          .toString("base64"),
        updatedAt: new Date().toISOString(),
      };
      await this.save({
        schemaVersion: STORE_SCHEMA_VERSION,
        entries: { ...store.entries, [credentialKey(origin)]: entry },
      });
    });
  }

  public getHttpsCredential(
    originValue: string,
  ): Promise<HttpsCredential | null> {
    return this.exclusive(async () => {
      this.assertEncryptionAvailable();
      const origin = normalizeHttpsOrigin(originValue);
      const entry = (await this.load()).entries[credentialKey(origin)];
      if (entry === undefined) return null;
      let secret: string;
      try {
        secret = this.options.encryption.decrypt(
          Buffer.from(entry.encryptedSecret, "base64"),
        );
      } catch {
        throw new CredentialStoreError(
          "invalid_store",
          "The credential cannot be decrypted on this device.",
        );
      }
      assertCredentialText(secret, "secret", MAX_SECRET_LENGTH);
      return { origin, username: entry.username, secret };
    });
  }

  public getHttpsCredentialStatus(
    originValue: string,
  ): Promise<HttpsCredentialStatus> {
    return this.exclusive(async () => {
      const origin = normalizeHttpsOrigin(originValue);
      const entry = (await this.load()).entries[credentialKey(origin)];
      return entry === undefined
        ? { origin, configured: false, username: null, updatedAt: null }
        : {
            origin,
            configured: true,
            username: entry.username,
            updatedAt: entry.updatedAt,
          };
    });
  }

  public deleteHttpsCredential(originValue: string): Promise<boolean> {
    return this.exclusive(async () => {
      const origin = normalizeHttpsOrigin(originValue);
      const store = await this.load();
      const key = credentialKey(origin);
      if (store.entries[key] === undefined) return false;
      const entries = { ...store.entries };
      delete entries[key];
      await this.save({ schemaVersion: STORE_SCHEMA_VERSION, entries });
      return true;
    });
  }

  private assertEncryptionAvailable(): void {
    if (!this.options.encryption.isAvailable()) {
      throw new CredentialStoreError(
        "encryption_unavailable",
        "Operating-system credential encryption is unavailable.",
      );
    }
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async load(): Promise<CredentialStoreFile> {
    let contents: string;
    try {
      const entry = await lstat(this.options.filePath);
      if (entry.isSymbolicLink() || !entry.isFile()) {
        throw new CredentialStoreError(
          "invalid_store",
          "The credential store path is unsafe.",
        );
      }
      contents = await readFile(this.options.filePath, "utf8");
    } catch (error) {
      if (isNodeError(error, "ENOENT")) {
        return { schemaVersion: STORE_SCHEMA_VERSION, entries: {} };
      }
      throw error;
    }
    return parseStore(contents);
  }

  private async save(store: CredentialStoreFile): Promise<void> {
    const parent = dirname(this.options.filePath);
    await mkdir(parent, { recursive: true, mode: 0o700 });
    await chmod(parent, 0o700);
    const temporaryPath = `${this.options.filePath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, {
        mode: 0o600,
        flag: "wx",
      });
      await rename(temporaryPath, this.options.filePath);
      await chmod(this.options.filePath, 0o600);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
}
