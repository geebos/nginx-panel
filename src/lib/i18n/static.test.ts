import assert from "node:assert/strict";
import test from "node:test";
import { getI18nProps, pickLocale } from "@/lib/i18n/static";

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
  const messages = props?.messages.common as {
    language: { label: string };
    settings: { general: { title: string } };
  };
  const fallback = props?.fallbackMessages.common as {
    language: { label: string };
    settings: { general: { title: string } };
  };
  assert.equal(messages.language.label, "语言");
  assert.equal(messages.settings.general.title, "通用");
  assert.equal(fallback.language.label, "Language");
  assert.equal(fallback.settings.general.title, "General");
});

test("getI18nProps rejects unsupported locale params", async () => {
  assert.equal(
    await getI18nProps({ params: { locale: "fr" } }, ["common"]),
    null,
  );
});
