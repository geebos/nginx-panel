import assert from "node:assert/strict";
import test from "node:test";
import { normalizeHostnames, sameHostnames } from "@/worker/lib/hostnames";

test("normalizeHostnames lowercases hostnames", () => {
  assert.deepEqual(normalizeHostnames(["ExAmPle.COM"]), ["example.com"]);
});

test("normalizeHostnames strips one trailing dot", () => {
  assert.deepEqual(normalizeHostnames(["example.com."]), ["example.com"]);
});

test("normalizeHostnames dedupes after normalize", () => {
  assert.deepEqual(normalizeHostnames(["A.com", "a.com", "a.com."]), ["a.com"]);
});

test("normalizeHostnames sorts lexicographically", () => {
  assert.deepEqual(normalizeHostnames(["b.com", "a.com"]), ["a.com", "b.com"]);
});

test("normalizeHostnames returns empty array for empty input", () => {
  assert.deepEqual(normalizeHostnames([]), []);
});

test("normalizeHostnames is identity for already normalized unique sorted input", () => {
  assert.deepEqual(normalizeHostnames(["a.com", "b.com"]), ["a.com", "b.com"]);
});

test("sameHostnames is order-insensitive", () => {
  assert.equal(sameHostnames(["b.com", "a.com"], ["a.com", "b.com"]), true);
});

test("sameHostnames is case and trailing-dot insensitive", () => {
  assert.equal(sameHostnames(["Example.com."], ["example.com"]), true);
});

test("sameHostnames is dedupe-aware", () => {
  assert.equal(sameHostnames(["a.com", "a.com"], ["a.com"]), true);
});

test("sameHostnames returns false for different sets", () => {
  assert.equal(sameHostnames(["a.com"], ["b.com"]), false);
});

test("sameHostnames returns true for both empty", () => {
  assert.equal(sameHostnames([], []), true);
});
