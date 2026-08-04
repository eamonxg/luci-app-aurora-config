import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

const ROOT = "htdocs/luci-static/resources";

// *.global.js 不由本仓库手写:color.global.js 是 vendored 的颜色库,
// tokens.global.js 是 @eamonxg/luci-theme-tokens 的生成产物(scripts/
// sync-tokens.mjs 同步,禁止手改)。两者各有几处箭头后紧跟的正则,但正则体里
// 没有相邻的 "/",jsmin 原样输出,不构成故障 —— 这条规则只约束我们自己的代码。
const VENDORED = /\.global\.js$/;

// jsmin 判断一个 "/" 是正则开头还是除号,靠前一个非空白字符是否属于
// "( , = : [ ! & | ? { } ; \n" —— 箭头的 ">" 不在表内,于是箭头后紧跟的正则
// 被当成除法,正则里相邻的两个 "/" 随即被当行注释,从那里到行尾整段消失。
// 源码 node --check 能过,坏的只有压缩产物,所以必须在源码层面挡住这个写法。
// 完整原委见 docs/DEVELOPMENT.md §11。
//
// 修法:正则先绑到常量上(前导是 "=",落在白名单内),箭头里只引用常量名。
const ARROW_THEN_REGEX = /=>\s*\/(?![/*])/g;

async function collectJs(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await collectJs(full)));
    else if (entry.name.endsWith(".js") && !VENDORED.test(entry.name))
      found.push(full);
  }
  return found;
}

test("no regex literal directly follows an arrow (jsmin would read it as division)", async () => {
  const files = await collectJs(ROOT);
  assert.ok(files.length > 0, "found no JS to scan -- wrong ROOT?");

  const offenders = [];
  for (const file of files) {
    const src = await readFile(file, "utf8");
    ARROW_THEN_REGEX.lastIndex = 0;
    let match;
    while ((match = ARROW_THEN_REGEX.exec(src)) !== null) {
      const line = src.slice(0, match.index).split("\n").length;
      offenders.push(`${file}:${line}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "bind the regex to a const first -- jsmin turns `=> /re/` into a syntax error:\n" +
      offenders.join("\n"),
  );
});

test("the shortcut url regex stays bound to a constant", async () => {
  const src = await readFile(join(ROOT, "view/aurora/gallery.js"), "utf8");
  assert.match(src, /const EXTERNAL_URL_RE = \/\^https\?:/);
  assert.match(src, /EXTERNAL_URL_RE\.test\(shortcutText\(url\)\)/);
  assert.match(src, /\.replace\(EXTERNAL_URL_RE, ""\)/);
});
