import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { srcPath } from "./paths.mjs";

const SRC = srcPath("view/aurora/studio.js");

// 登录背景与主界面背景共用一份前端管线:同一个 helper、同一段 LQIP 自动
// 生成。断言的是"只有一份实现"——第二份手抄的 LQIP 逻辑就是下一处 drift。

test("one background helper serves both the login and the main page", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /const addBackgroundOption = /);
  assert.match(src, /key: "struct_login_bg"/);
  assert.match(src, /key: "struct_main_bg"/);
  assert.match(src, /lqipKey: "struct_main_bg_lqip"/);
  // 更名后不许残留旧名(定义或调用都算 drift)
  assert.ok(!src.includes("toLoginBgUrl"), "toLoginBgUrl must be renamed to toBgUrl");
  assert.match(src, /const toBgUrl = /);
});

test("the three tunables write unit-suffixed values and default by absence", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /\["struct_main_bg_alpha", [^\]]*"%", 50, 100, "67",/);
  assert.match(src, /\["struct_main_bg_blur", [^\]]*"px", 0, 40, "20",/);
  assert.match(src, /\["struct_main_bg_scrim", [^\]]*"%", 0, 70, "20",/);
});

test("the LQIP auto-fill loop covers both background pairs", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /\["struct_login_bg", "struct_login_bg_lqip"/);
  assert.match(src, /\["struct_main_bg", "struct_main_bg_lqip"/);
});
