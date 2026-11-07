import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type { CredentialEncryption } from "./secure-credential-store.js";

const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

export function createEphemeralE2eCredentialEncryption(): CredentialEncryption {
  const key = randomBytes(32);
  return {
    isAvailable: () => true,
    encrypt: (plaintext) => {
      const iv = randomBytes(IV_LENGTH);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ciphertext = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ]);
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
    },
    decrypt: (payload) => {
      if (payload.length < IV_LENGTH + AUTH_TAG_LENGTH) {
        throw new Error("The E2E credential payload is invalid.");
      }
      const iv = payload.subarray(0, IV_LENGTH);
      const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
      const ciphertext = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(authTag);
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}
