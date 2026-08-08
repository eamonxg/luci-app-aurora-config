import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { srcPath } from "./paths.mjs";

const SRC = srcPath("view/aurora/studio.js");

// 背景组件的版式 CSS 曾寄养在 luci-theme-aurora 的按需补丁
// patches/admin-system-aurora.css 里。装在别的主题下(shadcn 有同样的补丁
// 机制、没有这张表)补丁根本不加载,.bg-preview 丢掉 position/height/overflow,
// 内部八层 absolute 逃到初始包含块糊满全页。app 自己的组件版式归 app,
// 这几条断言就是不让它再漂回主题。

test("the background component ships its own layout, not a theme patch", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /const ensureBgCardStyles = /);
  assert.match(src, /id: "aurora-bg-card-styles"/);
  // 渲染路径上必须真的调用,否则注入函数只是死代码
  assert.match(src, /ensureBgCardStyles\(\);/);
  for (const cls of [
    ".bg-duo",
    ".bg-preview",
    ".bg-srow",
    ".bg-pane",
    ".bg-card-head",
    "[data-bg-target]",
  ]) {
    assert.ok(src.includes(cls + " {") || src.includes(cls + ","), `${cls} 缺版式规则`);
  }
});

// 组件立在这一条上:预览的图层全是 absolute,它必须是那个定位、限高、裁剪的祖先。
test("the preview stays the positioned, sized, clipping ancestor", async () => {
  const src = await readFile(SRC, "utf8");
  const rule = src.match(/\.bg-preview \{[^}]*\}/);
  assert.ok(rule, ".bg-preview rule missing");
  for (const decl of ["position: relative", "overflow: hidden", "height: 130px"]) {
    assert.ok(rule[0].includes(decl), `.bg-preview must declare ${decl}`);
  }
});

// 主题词汇表不通用:shadcn 定义了 --surface/--bg/--brand,却没有
// --hairline/--text-subtle/--text-muted/--control-bg。裸 var() 会整条声明作废,
// 边框和次要文字就这么消失的。别名一律走 fallback 链,组件内联样式只认别名。
test("every theme value the component reads has a fallback chain", async () => {
  const src = await readFile(SRC, "utf8");
  const aliases = [
    "--bgp-line",
    "--bgp-subtle",
    "--bgp-muted",
    "--bgp-control",
    "--bgp-surface",
    "--bgp-bg",
    "--bgp-text",
    "--bgp-brand",
    "--bgp-radius",
  ];
  for (const alias of aliases) {
    const decl = src.match(
      new RegExp(`${alias}: var\\(--[a-z-]+, var\\(--[a-z-]+, [^;]+\\)\\);`),
    );
    assert.ok(decl, `${alias} must resolve through a two-step fallback chain`);
  }
  // 组件自己的样式只准引用别名 —— 注入表和 buildBgPreview 的内联样式两处。
  // 切片刻意只圈这两段:页面别处(字体管理器、资产库)仍直接用 Aurora token,
  // 那是另一码事,不该被这条断言连坐。
  const region = (from, to) =>
    src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));
  const component = [
    region("const ensureBgCardStyles", "const enhanceColorTokenGroups"),
    region("const buildBgPreview", "const addBackgroundOption"),
  ].join("\n");
  const bare = component.match(
    /var\(--(?:hairline|text-subtle|text-muted|control-bg|surface|bg|text|brand)\)/g,
  );
  assert.equal(
    bare,
    null,
    `bare theme tokens left in the component: ${bare?.join(", ")}`,
  );
});
