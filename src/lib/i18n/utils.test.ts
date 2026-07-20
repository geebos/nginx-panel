import assert from "node:assert/strict";
import test from "node:test";
import {
  localizePath,
  replacePathLocale,
  stripLocalePrefix,
} from "@/lib/i18n/utils";

test("localizePath prefixes internal paths without changing query or hash", () => {
  assert.equal(
    localizePath("/domains?tab=active#top", "zh-CN"),
    "/zh-CN/domains/?tab=active#top",
  );
});

test("replacePathLocale replaces an existing locale prefix", () => {
  assert.equal(replacePathLocale("/en/domains/", "zh-CN"), "/zh-CN/domains/");
});

test("stripLocalePrefix leaves non-localized and external paths usable", () => {
  assert.equal(stripLocalePrefix("/zh-CN/domains/?tab=active"), "/domains?tab=active");
  assert.equal(localizePath("https://example.com/docs", "zh-CN"), "https://example.com/docs");
});
