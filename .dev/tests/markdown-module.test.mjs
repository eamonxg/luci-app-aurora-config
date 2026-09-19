import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { srcPath } from "./paths.mjs";

const SRC = srcPath("utils/markdown.js");

async function load() {
  const src = await readFile(SRC, "utf8");
  const body = src
    .replace(/^"use strict";$/m, "")
    .replace(/^"require [^"]+";$/gm, "");
  return new Function("baseclass", body)({ extend: (obj) => obj });
}

// A document that can only do what the renderer is allowed to do. There is no
// innerHTML here to assign to: markup can only come out as element nodes the
// renderer chose to create.
const makeDoc = () => {
  const node = (tag) => ({
    tag,
    attrs: {},
    children: [],
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    setAttribute(name, value) {
      this.attrs[name] = String(value);
    },
  });
  return {
    createDocumentFragment: () => node("#fragment"),
    createElement: (tag) => node(tag),
    createTextNode: (text) => ({ text: String(text) }),
  };
};

const show = (n) => {
  if (n.text !== undefined) return n.text;
  const attrs = Object.keys(n.attrs)
    .map((k) => ` ${k}="${n.attrs[k]}"`)
    .join("");
  const inner = n.children.map(show).join("");
  return n.tag === "#fragment" ? inner : `<${n.tag}${attrs}>${inner}</${n.tag}>`;
};

const allow = (url) =>
  url.startsWith("https://") ? url : url.startsWith("admin/") ? "/cgi-bin/luci/" + url : "";

const html = (m, src, safeUrl) => show(m.render(src, makeDoc(), safeUrl || allow));

const tags = (n, out = []) => {
  if (n.tag && n.tag !== "#fragment") out.push(n.tag);
  (n.children || []).forEach((child) => tags(child, out));
  return out;
};

test("markdown.js: one dependency, a marked pure core, and no way to parse markup", async () => {
  const src = await readFile(SRC, "utf8");
  const requires = [...src.matchAll(/^"require ([^"]+)";$/gm)].map((m) => m[1]);
  assert.deepEqual(requires, ["baseclass"]);
  const open = src.indexOf("// <markdown-core>\n");
  const close = src.indexOf("// </markdown-core>\n");
  assert.ok(open > 0 && close > open, "the hub's admin console syncs the text between the markers");
  const core = src.slice(open, close);
  assert.match(core, /^function renderMarkdown\(src, doc, safeUrl\) \{$/m);
  assert.match(core, /^function markdownToText\(src\) \{$/m);
  for (const forbidden of ["innerHTML", "outerHTML", "insertAdjacentHTML", "DOMParser", "document.", "window", "L.", "baseclass", "_("])
    assert.ok(!core.includes(forbidden), `the core must not mention ${forbidden}`);
  // The core stands alone: evaluated with nothing in scope it still works.
  const standalone = new Function(core + "; return { renderMarkdown, markdownToText };")();
  assert.equal(show(standalone.renderMarkdown("**hi**", makeDoc(), allow)), "<p><strong>hi</strong></p>");
  assert.equal(standalone.markdownToText("# Title"), "Title");
});

test("markdown: paragraphs, headings, emphasis, inline code", async () => {
  const m = await load();
  assert.equal(html(m, "One\ntwo.\n\nThree."), "<p>One two.</p><p>Three.</p>");
  // The pane title is the only big heading, so # starts at h4.
  assert.equal(html(m, "# A\n## B\n### C\n#### D"), "<h4>A</h4><h5>B</h5><h6>C</h6><p>#### D</p>");
  assert.equal(html(m, "#nospace"), "<p>#nospace</p>");
  assert.equal(
    html(m, "**bold** and *italic* and `code <b>`"),
    "<p><strong>bold</strong> and <em>italic</em> and <code>code <b></code></p>",
  );
  assert.equal(html(m, "**bold with *italic* inside**"), "<p><strong>bold with <em>italic</em> inside</strong></p>");
  assert.equal(html(m, "2 * 3 * 4 and a ** b"), "<p>2 * 3 * 4 and a ** b</p>");
  assert.equal(html(m, "`*not italic*`"), "<p><code>*not italic*</code></p>");
});

test("markdown: fenced code, lists, blockquote, rule", async () => {
  const m = await load();
  assert.equal(
    html(m, "```\nuci set a.b='1'\n**raw** <b>\n\nstill code\n```\nafter"),
    "<pre><code>uci set a.b='1'\n**raw** <b>\n\nstill code</code></pre><p>after</p>",
  );
  assert.equal(html(m, "```sh\nopkg update"), "<pre><code>opkg update</code></pre>", "an open fence runs to the end");
  assert.equal(html(m, "- one\n- **two**\n* three"), "<ul><li>one</li><li><strong>two</strong></li><li>three</li></ul>");
  assert.equal(html(m, "1. one\n2. two\n\n3. three"), "<ol><li>one</li><li>two</li></ol><ol><li>three</li></ol>");
  assert.equal(html(m, "- one\n  wrapped\n- two"), "<ul><li>one wrapped</li><li>two</li></ul>");
  // Single level: an indented marker is just another item, never a nested list.
  assert.equal(html(m, "- one\n  - inner"), "<ul><li>one</li><li>inner</li></ul>");
  assert.equal(html(m, "> kept\n> together\n\ntext"), "<blockquote>kept together</blockquote><p>text</p>");
  assert.equal(html(m, "above\n\n---\n\nbelow"), "<p>above</p><hr></hr><p>below</p>");
});

test("markdown: links go through the caller's url rule, and nothing else becomes a link", async () => {
  const m = await load();
  assert.equal(
    html(m, "Read the [migration notes](https://themes.eamonxg.fun/notes)."),
    '<p>Read the <a href="https://themes.eamonxg.fun/notes" target="_blank" rel="noreferrer">migration notes</a>.</p>',
  );
  assert.equal(
    html(m, "[Open the store](admin/system/aurora/marketplace)"),
    '<p><a href="/cgi-bin/luci/admin/system/aurora/marketplace">Open the store</a></p>',
  );
  for (const url of ["javascript:alert`1`", "http://example.com/", "data:text/html,x", "//evil.example", "JAVASCRIPT:x"])
    assert.equal(html(m, `[click](${url})`), "<p>click</p>", url);
  // A parenthesis never belongs to a url here, so this is not a link at all.
  assert.equal(html(m, "[click](javascript:alert(1))"), "<p>[click](javascript:alert(1))</p>");
  // A rule that throws nothing but returns junk is still a refusal.
  for (const rule of [() => null, () => undefined, () => 1, () => ({}), () => "", null, undefined, "https://x"])
    assert.equal(show(m.render("[a](https://ok.example/)", makeDoc(), rule)), "<p>a</p>");
  // Bare urls, images and reference links are outside the subset.
  assert.equal(html(m, "https://example.com"), "<p>https://example.com</p>");
  assert.equal(html(m, "![alt](https://example.com/x.png)"), '<p>!<a href="https://example.com/x.png" target="_blank" rel="noreferrer">alt</a></p>');
  assert.deepEqual(tags(m.render("![alt](https://example.com/x.png)", makeDoc(), allow)).includes("img"), false);
  assert.equal(html(m, "[a [b](https://ok.example/) c]"), '<p>[a <a href="https://ok.example/" target="_blank" rel="noreferrer">b</a> c]</p>');
  assert.equal(html(m, "[a](https://ok.example/ title)"), "<p>[a](https://ok.example/ title)</p>");
});

test("markdown: raw HTML is text", async () => {
  const m = await load();
  const hostile = '<img src=x onerror="alert(1)"><script>alert(1)</script>';
  const tree = m.render(hostile + "\n\n<b>bold?</b> &amp; <!-- c -->", makeDoc(), allow);
  assert.deepEqual(tags(tree), ["p", "p"]);
  assert.equal(show(tree), `<p>${hostile}</p><p><b>bold?</b> &amp; <!-- c --></p>`);
  const allowed = ["p", "h4", "h5", "h6", "strong", "em", "code", "pre", "ul", "ol", "li", "blockquote", "hr", "a"];
  const everything = "# h\n\n**b** *i* `c` [l](https://a.b/)\n\n- x\n\n1. y\n\n> q\n\n---\n\n```\nz\n```\n\n| a | b |\n|---|---|";
  for (const tag of tags(m.render(everything, makeDoc(), allow))) assert.ok(allowed.includes(tag), tag);
  assert.equal(html(m, "| a | b |"), "<p>| a | b |</p>", "tables are outside the subset");
});

test("markdown: control characters are dropped, other input is coerced to nothing", async () => {
  const m = await load();
  const dirty = "a" + String.fromCharCode(0) + "b" + String.fromCharCode(27) + "[31mc" + String.fromCharCode(127) + "\r\nd\te";
  assert.equal(html(m, dirty), "<p>ab[31mc d\te</p>");
  for (const junk of [null, undefined, 5, {}, ["**x**"], { toString: () => "**x**" }]) {
    assert.equal(html(m, junk), "");
    assert.equal(m.toText(junk), "");
  }
  assert.equal(html(m, ""), "");
  assert.equal(html(m, "\n\n  \n"), "");
});

test("markdown: unterminated markers fall back to the characters that were typed", async () => {
  const m = await load();
  assert.equal(html(m, "**never closed"), "<p>**never closed</p>");
  assert.equal(html(m, "*never closed"), "<p>*never closed</p>");
  assert.equal(html(m, "`never closed"), "<p>`never closed</p>");
  assert.equal(html(m, "[never closed"), "<p>[never closed</p>");
  assert.equal(html(m, "[text](never closed"), "<p>[text](never closed</p>");
  assert.equal(html(m, "[](https://a.b/)"), "<p>[](https://a.b/)</p>");
  assert.equal(html(m, "[x]()"), "<p>[x]()</p>");
  assert.equal(html(m, "****"), "<p>****</p>");
  assert.equal(html(m, "``"), "<p>``</p>");
  assert.equal(html(m, "***x***"), "<p><strong>*x</strong>*</p>");
  // Emphasis nests to a fixed depth; past it the markers are text.
  assert.equal(html(m, "**a *b `c` **d** e* f**").includes("<script"), false);
});

test("markdown: hostile input costs time in proportion to its length", async () => {
  const m = await load();
  const N = 200000;
  const cases = {
    "open brackets": "[".repeat(N),
    "nested brackets": "[a".repeat(N / 2) + "](https://a.b/)",
    "bracket pairs": "[]".repeat(N / 2),
    "half links": "[a](".repeat(N / 4),
    stars: "*".repeat(N),
    "spaced stars": "* a".repeat(N / 3),
    "star pairs": "**a ".repeat(N / 4),
    "unclosed strong then singles": "**" + "*a".repeat(N / 2),
    backticks: "`".repeat(N),
    "backtick words": "`a ".repeat(N / 3) ,
    "one huge line": "x".repeat(N),
    "many lines": "- x\n".repeat(N / 4),
    "many fences": "```\n".repeat(N / 4),
    "many quotes": "> ".repeat(N / 2),
    hashes: "#".repeat(N),
    "nested emphasis": "**a *b ".repeat(N / 8) + " b* a**".repeat(N / 8),
  };
  for (const [name, input] of Object.entries(cases)) {
    const started = process.hrtime.bigint();
    m.render(input, makeDoc(), allow);
    m.toText(input);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    // Linear work on 200 KB is a few milliseconds; a quadratic path is minutes.
    assert.ok(ms < 1500, `${name}: ${ms.toFixed(0)} ms`);
  }
});

test("markdownToText: the first line that says something, without its markers", async () => {
  const m = await load();
  assert.equal(m.toText("Browsing keeps working; **publishing** is paused.\n\nMore."), "Browsing keeps working; publishing is paused.");
  assert.equal(m.toText("\n\n## Heads *up*\n\nbody"), "Heads up");
  assert.equal(m.toText("- first item\n- second"), "first item");
  assert.equal(m.toText("3. third"), "third");
  assert.equal(m.toText("> quoted `code`"), "quoted code");
  assert.equal(m.toText("---\n\nafter the rule"), "after the rule");
  assert.equal(m.toText("```\n\nuci show\n```"), "uci show");
  assert.equal(m.toText("See [the notes](https://a.b/) now"), "See the notes now");
  assert.equal(m.toText("[x](javascript:alert)"), "x");
  assert.equal(m.toText("line one\nline two"), "line one");
  assert.equal(m.toText("<b>raw</b>"), "<b>raw</b>");
  assert.equal(m.toText("   "), "");
});
