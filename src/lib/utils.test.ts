import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "@/lib/utils";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

test("randomUUID returns a v4-shaped id", () => {
  const value = randomUUID();
  assert.match(value, UUID_RE);
});

test("randomUUID falls back when crypto.randomUUID is missing", () => {
  const original = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      getRandomValues(bytes: Uint8Array) {
        for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 17 + 3) & 0xff;
        return bytes;
      },
    },
  });
  try {
    const value = randomUUID();
    assert.match(value, UUID_RE);
  } finally {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: original,
    });
  }
});
