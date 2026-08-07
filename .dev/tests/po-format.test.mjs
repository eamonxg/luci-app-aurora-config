import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import { repo } from "./paths.mjs";

// msgfmt --check-format only inspects entries flagged `#, c-format`, and
// merge-po.mjs writes no flags -- so running it over these catalogues proves
// nothing at all (verified by mutating a msgstr's %d to %s: msgfmt stayed
// silent). LuCI's translate() does the substitution itself, and a msgstr whose
// placeholders do not match its msgid renders as a broken string on a device
// nobody testing in English will ever look at. So the check lives here.

// .DS_Store 也在这个目录里,所以按"有没有 aurora-config.po"筛,而不是按名字排除。
const LANGS = readdirSync(repo("po"), { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== "templates")
  .map((d) => d.name)
  .sort();

const parse = (text) =>
  [...text.matchAll(/msgid "((?:[^"\\]|\\.)*)"\nmsgstr "((?:[^"\\]|\\.)*)"\n/g)]
    .map((m) => ({ msgid: m[1], msgstr: m[2] }))
    .filter((e) => e.msgid !== "");

// %% is a literal percent, not a placeholder -- strip it before counting.
const placeholders = (s) => (s.replace(/%%/g, "").match(/%[a-z]/g) || []);

test("po: 每个 msgstr 的占位符与 msgid 逐个对应", () => {
  const problems = [];
  for (const lang of LANGS) {
    for (const { msgid, msgstr } of parse(
      readFileSync(repo(`po/${lang}/aurora-config.po`), "utf8"),
    )) {
      if (!msgstr) continue;
      const want = placeholders(msgid);
      const got = placeholders(msgstr);
      // 顺序也要一致:LuCI 的 format() 按位置取参,换个顺序就是把体积填进个数里。
      if (want.join(",") !== got.join(",")) {
        problems.push(`${lang}: [${want}] vs [${got}]  ${msgid.slice(0, 50)}`);
      }
      // %% 的个数也不能变 —— 少一个,进度条就会把 "50%" 显示成 "50"。
      if ((msgid.match(/%%/g) || []).length !== (msgstr.match(/%%/g) || []).length) {
        problems.push(`${lang}: %% count  ${msgid.slice(0, 50)}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("po: 十四个语种一条不缺、一条不空", () => {
  const pot = parse(readFileSync(repo("po/templates/aurora-config.pot"), "utf8"));
  assert.equal(LANGS.length, 14);
  for (const lang of LANGS) {
    const entries = parse(readFileSync(repo(`po/${lang}/aurora-config.po`), "utf8"));
    assert.equal(entries.length, pot.length, `${lang} 条目数与模板不符`);
    const empty = entries.filter((e) => !e.msgstr).map((e) => e.msgid);
    // 空 msgstr 会原样吐出英文,看起来像"这条忘了翻",而不是"这条没有译文"。
    assert.deepEqual(empty, [], `${lang} 有未翻译条目`);
  }
});
