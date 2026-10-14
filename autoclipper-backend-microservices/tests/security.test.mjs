import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { seal, unseal, same } from "@autoclipper/http-security";
import { permits } from "../apps/autoclipper-workspace-service/dist/domain/permissions.js";
test("encrypted outbox detects tampering and does not store plaintext", () => {
  const key = randomBytes(32).toString("hex");
  const value = "sensitive-one-use-token";
  const encrypted = seal(value, key);
  assert.equal(encrypted.includes(value), false);
  assert.equal(unseal(encrypted, key), value);
  const modified = Buffer.from(encrypted, "base64");
  modified[30] ^= 1;
  assert.throws(() => unseal(modified.toString("base64"), key));
  assert.throws(() => unseal(encrypted, randomBytes(32).toString("hex")));
  assert.equal(same("é", "a"), false);
  const bound = seal(value, key, "mfa:alice");
  assert.equal(unseal(bound, key, "mfa:alice"), value);
  assert.throws(() => unseal(bound, key, "mfa:bob"));
});
test("workspace role hierarchy does not grant reader/editor administrative access", () => {
  assert.equal(permits("reader", "reader"), true);
  assert.equal(permits("reader", "editor"), false);
  assert.equal(permits("editor", "admin"), false);
  assert.equal(permits("admin", "owner"), false);
  assert.equal(permits("owner", "admin"), true);
});
