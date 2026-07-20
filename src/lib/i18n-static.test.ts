import assert from "node:assert/strict";
import test from "node:test";
import { getI18nProps, pickLocale } from "./i18n-static";

test("pickLocale extracts nested messages for one locale", () => {
  assert.deepEqual(
    pickLocale(
      {
        title: { en: "Title", "zh-CN": "标题" },
        nested: { label: { en: "Label", "zh-CN": "标签" } },
      },
      "zh-CN",
    ),
    { title: "标题", nested: { label: "标签" } },
  );
});

test("getI18nProps loads current and fallback messages", async () => {
  const props = await getI18nProps(
    { params: { locale: "zh-CN" } },
    ["common"],
  );

  assert.equal(props?.locale, "zh-CN");
  assert.deepEqual(props?.messages, {
    common: {
      language: { label: "语言", en: "English", "zh-CN": "简体中文" },
    },
  });
  assert.deepEqual(props?.fallbackMessages, {
    common: {
      language: { label: "Language", en: "English", "zh-CN": "简体中文" },
    },
  });
});

test("getI18nProps rejects unsupported locale params", async () => {
  assert.equal(
    await getI18nProps({ params: { locale: "fr" } }, ["common"]),
    null,
  );
});
