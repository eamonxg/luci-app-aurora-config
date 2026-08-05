import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { repo, srcPath } from "./paths.mjs";

const SRC = srcPath("utils/theme-preview.js");

// buildMini/logoImage 是 DOM 构造器,所以这些测试用一份 LuCI 全局(E 和
// document)的替身把它们真跑起来,而不是对着源码做正则。替身只实现模块用到
// 的那几样:children、style、addEventListener、appendChild、replaceChild。
function makeNode(tag, attrs) {
  return {
    tag,
    attrs: attrs || {},
    style: {},
    children: [],
    parentNode: null,
    listeners: {},
    addEventListener(type, fn) {
      (this.listeners[type] = this.listeners[type] || []).push(fn);
    },
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    replaceChild(next, prev) {
      const i = this.children.indexOf(prev);
      assert.notEqual(i, -1, "replaceChild called with a node that is not a child");
      this.children[i] = next;
      next.parentNode = this;
      prev.parentNode = null;
      return prev;
    },
  };
}

const E = (tag, attrs, children) => {
  const node = makeNode(tag, attrs);
  const list =
    children === undefined || children === null
      ? []
      : Array.isArray(children)
        ? children
        : [children];
  list.forEach((child) => node.appendChild(child));
  return node;
};

const documentStub = {
  createTextNode: (text) => ({ tag: "#text", text, parentNode: null, children: [] }),
};

async function load() {
  const src = await readFile(SRC, "utf8");
  const body = src
    .replace(/^"use strict";$/m, "")
    .replace(/^"require [^"]+";$/gm, "");
  return new Function("baseclass", "E", "document", body)(
    { extend: (obj) => obj },
    E,
    documentStub,
  );
}

function walk(node, out) {
  out = out || [];
  out.push(node);
  (node.children || []).forEach((child) => walk(child, out));
  return out;
}

const findAll = (node, tag) => walk(node).filter((n) => n.tag === tag);

const PAL = { bg: "#101010", surface: "#202020", text: "#303030", brand: "#40a0f0" };
const LOGO = "https://themes.example/assets/6zcxcg07/logo_svg";

test("theme-preview draws all three nav_type shapes", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /nav === "sidebar"/, "missing sidebar branch");
  assert.match(src, /nav === "mega-menu"/, "missing mega-menu branch");
  // dropdown 走的是「其它一律顶栏」的默认分支,所以只断言注释写清了这件事
  assert.match(src, /dropdown/, "nav_type contract not documented");
});

test("theme-preview keeps geometry static and only colors variable", async () => {
  const src = await readFile(SRC, "utf8");
  assert.ok(!src.includes(".innerHTML"), "no innerHTML in preview module");
  // 每一处颜色赋值都必须先过 safeHex,不能把原始值拼进 style 字符串
  assert.match(src, /const safeHex = \(value, fallback\) =>/);
  assert.match(src, /HEX_RE\.test/);
});

test("theme-preview mega-menu panel shifts the content area down", async () => {
  const src = await readFile(SRC, "utf8");
  // 顶栏 16% + 面板 13% = 29%,内容区起点必须让开,不能还用顶栏的 24%
  assert.match(src, /37%/, "mega-menu content offset missing");
});

test("buildMini without a logo draws no image at all", async () => {
  const m = await load();
  assert.equal(findAll(m.buildMini(PAL, { nav: "dropdown" }), "img").length, 0);
  assert.equal(findAll(m.buildMini(PAL, { nav: "sidebar", logo: "" }), "img").length, 0);
});

test("buildMini puts the logo where the brand square goes, in every nav shape", async () => {
  const m = await load();
  ["dropdown", "mega-menu", "sidebar"].forEach((nav) => {
    const imgs = findAll(m.buildMini(PAL, { nav: nav, logo: LOGO }), "img");
    assert.equal(imgs.length, 1, `expected exactly one logo image for nav=${nav}`);
    assert.equal(imgs[0].attrs.src, LOGO);
    // 装饰性图像:旁边的清单小块已经把它叫出名字了
    assert.equal(imgs[0].attrs.alt, "");
  });
});

test("a logo that fails to load falls back to the brand square in the same slot", async () => {
  const m = await load();
  const root = m.buildMini(PAL, { nav: "dropdown", logo: LOGO });
  const img = findAll(root, "img")[0];
  const bar = img.parentNode;
  const slot = bar.children.indexOf(img);

  assert.ok(img.listeners.error && img.listeners.error.length, "missing error handler");
  img.listeners.error.forEach((fn) => fn());

  const replacement = bar.children[slot];
  assert.notEqual(replacement, img, "the broken image is still in the tree");
  assert.equal(findAll(root, "img").length, 0, "no broken image may survive");
  // 同一个槽位、同一块品牌色、同样的尺寸 —— 不跳版,也不会再发一次请求
  assert.equal(replacement.style.background, "#40a0f0");
  assert.equal(bar.children.length, 4);
});

test("buildDuo forwards the logo to both the light and the dark mini", async () => {
  const m = await load();
  const duo = m.buildDuo({ light: PAL, dark: PAL }, { nav: "sidebar", logo: LOGO });
  assert.equal(findAll(duo, "img").length, 2);
});

test("logoImage hands back the fallback untouched when there is no url", async () => {
  const m = await load();
  const fallback = documentStub.createTextNode("◆");
  assert.equal(m.logoImage("", fallback, "width:15px;"), fallback);
  assert.equal(m.logoImage(null, fallback, "width:15px;"), fallback);
});

test("logoImage loads hub SVG only through an img src, never as markup", async () => {
  const src = await readFile(SRC, "utf8");
  // hub 的 logo 是用户上传的 SVG。放在 <img> 里它跑不了脚本,放在 DOM 里别的
  // 地方就能。这是硬规矩,所以直接断言。
  //
  // 扫的是代码不是散文:模块顶上的安全注释本身就点了这几个 API 的名字,
  // 拿原文去扫会被自己的注释绊倒。
  const code = src.replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!code.includes(".innerHTML"), "no innerHTML anywhere in this module");
  assert.ok(!/insertAdjacentHTML|DOMParser|createContextualFragment/.test(code));
  assert.match(code, /E\("img", \{\s*src:/, "the logo must be loaded as an img src");
});
