"use strict";
"require baseclass";

// 两条标记注释之间是纯函数，hub 管理台的预览由同步脚本逐字取用这一段：
// 里面不得引用 LuCI、window 或本文件的其它部分。
// <markdown-core>
const MD_MAX_DEPTH = 2;
const MD_HEADING_OFFSET = 3;
const MD_FENCE = "```";
const MD_HEADING_RE = /^(#{1,3}) +(.*)$/;
const MD_RULE_RE = /^-{3,} *$/;
const MD_QUOTE_RE = /^> ?/;
const MD_BULLET_RE = /^[-*] +/;
const MD_NUMBER_RE = /^[0-9]{1,9}[.] +/;
const MD_EXTERNAL_RE = /^https:/;

function mdClean(src) {
  const text = typeof src === "string" ? src : "";
  let out = "";
  let from = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if ((code < 32 && code !== 9 && code !== 10) || code === 127) {
      out += text.slice(from, i);
      from = i + 1;
    }
  }
  return out + text.slice(from);
}

// 每个分隔符只向右找一次「最近的闭合」；找不到就记下来，同一种分隔符不再找。
// 方括号的扫描遇到下一个 "[" 就停。两条合起来保证整体是线性的。
function mdInline(text, depth) {
  const tokens = [];
  const dead = {};
  let plain = "";
  let i = 0;

  const flush = () => {
    if (plain) tokens.push({ type: "text", text: plain });
    plain = "";
  };
  const closer = (mark, from) => {
    if (dead[mark]) return -1;
    const at = text.indexOf(mark, from);
    if (at === -1) dead[mark] = true;
    return at;
  };
  const nested = (inner) =>
    depth < MD_MAX_DEPTH ? mdInline(inner, depth + 1) : [{ type: "text", text: inner }];

  while (i < text.length) {
    const ch = text[i];

    if (ch === "`") {
      const end = closer("`", i + 1);
      if (end > i + 1) {
        flush();
        tokens.push({ type: "code", text: text.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    } else if (ch === "*") {
      const mark = text[i + 1] === "*" ? "**" : "*";
      const start = i + mark.length;
      if (start < text.length && text[start] !== " ") {
        const end = closer(mark, start);
        if (end > start && text[end - 1] !== " ") {
          flush();
          tokens.push({
            type: mark === "**" ? "strong" : "em",
            children: nested(text.slice(start, end)),
          });
          i = end + mark.length;
          continue;
        }
      }
      if (mark === "**") {
        plain += mark;
        i += 2;
        continue;
      }
    } else if (ch === "[") {
      let j = i + 1;
      while (j < text.length && text[j] !== "[" && text[j] !== "]") j += 1;
      if (j > i + 1 && text[j] === "]" && text[j + 1] === "(") {
        let k = j + 2;
        while (k < text.length && text[k] !== ")" && text[k] !== "(" && text[k] !== " ") k += 1;
        if (k > j + 2 && text[k] === ")") {
          flush();
          tokens.push({ type: "link", text: text.slice(i + 1, j), url: text.slice(j + 2, k) });
          i = k + 1;
          continue;
        }
      }
    }

    plain += ch;
    i += 1;
  }

  flush();
  return tokens;
}

function mdBlocks(src) {
  const lines = mdClean(src).split("\n");
  const blocks = [];
  let open = null;

  const close = () => {
    open = null;
  };
  const extend = (type, text) => {
    if (open && open.type === type) open.lines.push(text);
    else {
      open = { type: type, lines: [text] };
      blocks.push(open);
    }
  };
  const item = (type, text) => {
    if (open && open.type === type) open.items.push(text);
    else {
      open = { type: type, items: [text] };
      blocks.push(open);
    }
  };

  for (let n = 0; n < lines.length; n += 1) {
    const line = lines[n];
    const trimmed = line.trim();

    if (trimmed.startsWith(MD_FENCE)) {
      const code = [];
      n += 1;
      while (n < lines.length && !lines[n].trim().startsWith(MD_FENCE)) {
        code.push(lines[n]);
        n += 1;
      }
      close();
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }
    if (trimmed === "") {
      close();
      continue;
    }

    const heading = MD_HEADING_RE.exec(trimmed);
    if (heading) {
      close();
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] });
    } else if (MD_RULE_RE.test(trimmed)) {
      close();
      blocks.push({ type: "rule" });
    } else if (MD_QUOTE_RE.test(trimmed)) extend("quote", trimmed.replace(MD_QUOTE_RE, ""));
    else if (MD_BULLET_RE.test(trimmed)) item("bullets", trimmed.replace(MD_BULLET_RE, ""));
    else if (MD_NUMBER_RE.test(trimmed)) item("numbers", trimmed.replace(MD_NUMBER_RE, ""));
    else if (open && open.items) open.items[open.items.length - 1] += " " + trimmed;
    else extend("paragraph", trimmed);
  }

  return blocks;
}

function mdPlain(tokens) {
  return tokens
    .map((token) => (token.children ? mdPlain(token.children) : token.text))
    .join("");
}

function renderMarkdown(src, doc, safeUrl) {
  const root = doc.createDocumentFragment();

  const inline = (parent, tokens) => {
    tokens.forEach((token) => {
      if (token.type === "text") parent.appendChild(doc.createTextNode(token.text));
      else if (token.type === "code") {
        const code = doc.createElement("code");
        code.appendChild(doc.createTextNode(token.text));
        parent.appendChild(code);
      } else if (token.type === "link") {
        const href = typeof safeUrl === "function" ? safeUrl(token.url) : "";
        if (typeof href !== "string" || href === "") {
          parent.appendChild(doc.createTextNode(token.text));
          return;
        }
        const link = doc.createElement("a");
        link.setAttribute("href", href);
        if (MD_EXTERNAL_RE.test(href)) {
          link.setAttribute("target", "_blank");
          link.setAttribute("rel", "noreferrer");
        }
        link.appendChild(doc.createTextNode(token.text));
        parent.appendChild(link);
      } else {
        const node = doc.createElement(token.type === "strong" ? "strong" : "em");
        inline(node, token.children);
        parent.appendChild(node);
      }
    });
    return parent;
  };

  const element = (tag, text) => inline(doc.createElement(tag), mdInline(text, 0));

  mdBlocks(src).forEach((block) => {
    if (block.type === "code") {
      const pre = doc.createElement("pre");
      const code = doc.createElement("code");
      code.appendChild(doc.createTextNode(block.text));
      pre.appendChild(code);
      root.appendChild(pre);
    } else if (block.type === "rule") root.appendChild(doc.createElement("hr"));
    else if (block.type === "heading")
      root.appendChild(element("h" + (block.level + MD_HEADING_OFFSET), block.text));
    else if (block.items) {
      const list = doc.createElement(block.type === "numbers" ? "ol" : "ul");
      block.items.forEach((text) => list.appendChild(element("li", text)));
      root.appendChild(list);
    } else
      root.appendChild(
        element(block.type === "quote" ? "blockquote" : "p", block.lines.join(" ")),
      );
  });

  return root;
}

function markdownToText(src) {
  const blocks = mdBlocks(src);
  for (let n = 0; n < blocks.length; n += 1) {
    const block = blocks[n];
    let text = "";
    if (block.type === "code")
      text = block.text.split("\n").filter((line) => line.trim() !== "")[0] || "";
    else if (block.type === "heading") text = mdPlain(mdInline(block.text, 0));
    else if (block.items) text = mdPlain(mdInline(block.items[0], 0));
    else if (block.lines) text = mdPlain(mdInline(block.lines[0], 0));
    if (text.trim() !== "") return text.trim();
  }
  return "";
}
// </markdown-core>

return baseclass.extend({
  render: renderMarkdown,
  toText: markdownToText,
});
