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

// ── B 组件:背景分区并入品牌 tab 且排最前,选图 + 预览 + 滑杆共用一份实现 ──
test("backgrounds top the branding tab instead of owning a separate one", async () => {
  const src = await readFile(SRC, "utf8");
  // 独立 tab 已撤:上传在资产库、选择在背景区,分开两个 tab 就是断流程
  assert.doesNotMatch(src, /s\.tab\("backgrounds"/);
  assert.match(src, /_\("Page Backgrounds"\)/);
  // 分区顺序:资产库置顶统一管理 → 背景 → 品牌
  const libAt = src.indexOf('"_asset_library"');
  const bgAt = src.indexOf('"_background_settings"');
  const brandAt = src.indexOf('"_branding_settings"');
  assert.ok(
    libAt > 0 && libAt < bgAt && bgAt < brandAt,
    "order must be asset library, backgrounds, branding",
  );
  // 两个背景都挂在分区 subsection 上
  assert.equal(src.match(/addBackgroundOption\(bgSubsection/g)?.length, 2);
  // 站点品牌分区不再描述登录背景
  assert.doesNotMatch(src, /and the login background/);
});

test("upload is embedded in the component, tagged with its owning key", async () => {
  const src = await readFile(SRC, "utf8");
  // 按钮 + 拖拽双入口,复用资产库同一条上传管线
  assert.match(src, /_\("Upload image"\)/);
  assert.match(src, /addEventListener\("drop"/);
  assert.match(src, /callUploadIcon\(file\.name\)/);
  // pending 带归属键:主背景的上传不再误落到登录背景上
  assert.match(src, /aurora\.pending_bg_key/);
  assert.match(src, /pendingKey === key/);
  // 上传入口只归主背景;登录背景纯选择,上传统一走置顶的资产库
  assert.match(src, /key: "struct_main_bg"[\s\S]{0,400}withUpload: true/);
  assert.doesNotMatch(src, /key: "struct_login_bg"[\s\S]{0,300}withUpload/);
});

test("the shared component previews live and drives tunables with sliders", async () => {
  const src = await readFile(SRC, "utf8");
  // 滑杆而不是裸数字输入;隐藏字段仍是三个 struct 键(保存管线不变)
  assert.match(src, /type: "range"/);
  assert.match(src, /tunables/);
  assert.match(src, /\["struct_main_bg_alpha", [^\]]*"%", 50, 100, "67",/);
  // 预览读选图的 url() 并随滑杆联动
  assert.match(src, /buildBgPreview|bg-preview/);
});
