// AES-GCM-256 + PBKDF2-SHA256 envelope helpers.
// Exposes window.CardsCrypto = { encryptJson, decryptEnvelope, isEnvelope }.
(() => {
  const PBKDF2_ITER = 310000;
  const KEY_LEN = 256;
  const SALT_LEN = 16;
  const IV_LEN = 12;

  function bytesToB64(bytes) {
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  }
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function deriveKey(passphrase, salt) {
    const baseKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(passphrase),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITER },
      baseKey,
      { name: "AES-GCM", length: KEY_LEN },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptJson(obj, passphrase) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
    const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
    const key = await deriveKey(passphrase, salt);
    const plaintext = new TextEncoder().encode(JSON.stringify(obj));
    const ctBuf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
    return {
      v: 1,
      alg: "AES-GCM-256",
      kdf: "PBKDF2-SHA256",
      iter: PBKDF2_ITER,
      salt: bytesToB64(salt),
      iv: bytesToB64(iv),
      ct: bytesToB64(new Uint8Array(ctBuf)),
    };
  }

  async function decryptEnvelope(env, passphrase) {
    if (!isEnvelope(env)) throw new Error("不正な暗号データです");
    const salt = b64ToBytes(env.salt);
    const iv = b64ToBytes(env.iv);
    const ct = b64ToBytes(env.ct);
    const key = await deriveKey(passphrase, salt);
    let plainBuf;
    try {
      plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    } catch (e) {
      throw new Error("パスフレーズが違います（または破損データ）");
    }
    return JSON.parse(new TextDecoder().decode(plainBuf));
  }

  function isEnvelope(env) {
    return env && typeof env === "object" &&
      env.alg === "AES-GCM-256" &&
      typeof env.salt === "string" &&
      typeof env.iv === "string" &&
      typeof env.ct === "string";
  }

  window.CardsCrypto = { encryptJson, decryptEnvelope, isEnvelope };
})();
