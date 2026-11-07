import { safeStorage } from "electron";

import type { CredentialEncryption } from "./secure-credential-store.js";

export const electronCredentialEncryption: CredentialEncryption = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plaintext) => safeStorage.encryptString(plaintext),
  decrypt: (ciphertext) => safeStorage.decryptString(ciphertext),
};
