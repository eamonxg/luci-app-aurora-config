import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { repo } from "./paths.mjs";

// 快捷方式和资产走同一条规矩:应用一个主题就是穿上它那一套,内置和社区没有
// 分别 —— 主题带了就应用,没带就是没有。这一组守的是「内置预设也带快捷方式」
// 和「指不到文件的图标不留在配置里」。

const rpcd = readFileSync(repo("root/usr/libexec/rpcd/luci.aurora"), "utf8");
const PRESETS = ["default", "sage-green", "amber-sand", "monochrome", "sky-blue"];

function slice(name) {
  const start = rpcd.indexOf(`${name}() {`);
  assert.ok(start !== -1, `${name} not found in rpcd script`);
  const end = rpcd.indexOf("\n}\n", start) + 3;
  return rpcd.slice(start, end);
}

const DEPS =
  slice("has_control_char") + slice("has_batch_unsafe_char") + slice("load_preset_toolbar");

function loadToolbar(templateText) {
  const dir = mkdtempSync(join(tmpdir(), "aurora-tb-"));
  const path = join(dir, "x.template");
  writeFileSync(path, templateText);
  try {
    const out = execFileSync(
      "sh",
      [
        "-c",
        DEPS +
          `\nif load_preset_toolbar "${path}"; then\n` +
          `  printf 'OK\\n'; printf '%s\\n' "$PRESET_TOOLBAR"\n` +
          `else printf 'FAIL\\n'; fi\n`,
      ],
      { encoding: "utf8" },
    ).split("\n");
    const ok = out[0] === "OK";
    return {
      ok,
      rows: ok ? out.slice(1).filter(Boolean).map((l) => l.split("\t")) : [],
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const block = (title, url, icon, enabled) =>
  [
    "config toolbar_item",
    `\toption title '${title}'`,
    `\toption url '${url}'`,
    ...(icon === null ? [] : [`\toption icon '${icon}'`]),
    `\toption enabled '${enabled}'`,
    "",
  ].join("\n");

const wrap = (...blocks) =>
  ["config aurora 'theme'", "\toption nav_type 'sidebar'", "", ...blocks].join("\n");

// ---------------------------------------------------------------------------
// 每个内置预设都带着自己的快捷方式
// ---------------------------------------------------------------------------

test("every built-in template carries the same four shortcuts", () => {
  let reference = null;
  for (const preset of PRESETS) {
    const file = repo(`root/usr/share/aurora/${preset}.template`);
    const { ok, rows } = loadToolbar(readFileSync(file, "utf8"));
    assert.ok(ok, `${preset}: template rejected by load_preset_toolbar`);
    assert.equal(rows.length, 4, `${preset}: expected 4 shortcuts`);
    // 图标必须是主题自带的那几张,否则接收端 drop_missing_toolbar_icons 会把
    // 它清掉,预设就成了一排没有图标的按钮。
    for (const [, , , icon] of rows) {
      assert.match(icon, /^(overview|system|software|network)\.svg$/, `${preset}: ${icon}`);
    }
    if (reference === null) reference = JSON.stringify(rows);
    else assert.equal(JSON.stringify(rows), reference, `${preset} drifted from default`);
  }
});

test("a template with no toolbar_item parses as 'no shortcuts', not as an error", () => {
  const { ok, rows } = loadToolbar(wrap());
  assert.equal(ok, true, "没有快捷方式是一个合法的主题,不是一份坏模板");
  assert.deepEqual(rows, []);
});

test("shortcut fields survive parsing intact", () => {
  const { ok, rows } = loadToolbar(
    wrap(
      block("My Site", "https://example.com/a b", "my-icon.png", "1"),
      block("No Icon", "/cgi-bin/luci/admin", null, "0"),
    ),
  );
  assert.ok(ok);
  // icon 排在最后且唯一可空：TAB 是 IFS 空白类，空的中间字段会让 read 把后面
  // 的字段整体左移（enabled 被读进 icon）。这条断言就是钉住那个顺序的。
  assert.deepEqual(rows, [
    ["My Site", "https://example.com/a b", "1", "my-icon.png"],
    ["No Icon", "/cgi-bin/luci/admin", "0", ""],
  ]);
});

// ---------------------------------------------------------------------------
// 校验:与 hub 那一份同一套界
// ---------------------------------------------------------------------------

const rejected = [
  ["title 带单引号（会撑破 uci batch 的引号）", block("It's", "/x", "a.png", "1")],
  ["title 超过 30 字", block("x".repeat(31), "/x", "a.png", "1")],
  ["title 为空", block("", "/x", "a.png", "1")],
  ["url 没有 scheme 也不以 / 开头", block("T", "example.com", "a.png", "1")],
  ["url 是协议相对地址", block("T", "//example.com", "a.png", "1")],
  ["url 超过 200 字", block("T", "/" + "x".repeat(200), "a.png", "1")],
  ["enabled 不是 0/1", block("T", "/x", "a.png", "2")],
  ["enabled 缺席", "config toolbar_item\n\toption title 'T'\n\toption url '/x'\n"],
  ["icon 含非法字符", block("T", "/x", "a b.png", "1")],
  ["icon 带路径穿越", block("T", "/x", "../../etc/passwd", "1")],
];

test("load_preset_toolbar rejects what the hub payload would reject", () => {
  for (const [why, bad] of rejected) {
    const { ok } = loadToolbar(wrap(bad));
    assert.equal(ok, false, `应当拒绝：${why}`);
  }
});

test("more than 12 shortcuts is rejected, same cap as the hub", () => {
  const many = Array.from({ length: 13 }, (_, i) => block(`T${i}`, `/x${i}`, null, "1"));
  assert.equal(loadToolbar(wrap(...many)).ok, false);
  const twelve = Array.from({ length: 12 }, (_, i) => block(`T${i}`, `/x${i}`, null, "1"));
  assert.equal(loadToolbar(wrap(...twelve)).ok, true);
});

// ---------------------------------------------------------------------------
// drop_missing_toolbar_icons：指不到文件的图标不许留在配置里
// ---------------------------------------------------------------------------

const UCI_STUB = `
uci() {
  cmd=""; arg=""
  for a in "$@"; do
    case "$a" in -*) continue ;; esac
    if [ -z "$cmd" ]; then cmd="$a"; else arg="$a"; break; fi
  done
  case "$cmd" in
    # 真 uci show 的两种行:段头 aurora.<sid>=<type> 不带引号,选项
    # aurora.<sid>.<opt>='<value>' 带引号。段头按点数区分(1 个点 = 段头)。
    # 一律加引号的桩会让 drop_missing 的 sed 一个 toolbar_item 都找不到,
    # 断言于是永远成立。
    show) awk '{ i=index($0,"="); k=substr($0,1,i-1); v=substr($0,i+1);
                 n=gsub(/\\./,".",k)
                 if (n <= 1) printf "%s=%s\\n", k, v
                 else printf "%s=%c%s%c\\n", k, 39, v, 39 }' "$UCI_DB" ;;
    # 按字面前缀比,不能用 grep:uci 的匿名段 id 长成 @toolbar_item[0],里面的
    # [0] 会被 grep 当成字符类,于是任何带匿名段的键都查不到、也删不掉。
    get)
      awk -v k="$arg" 'index($0, k "=") == 1 { print substr($0, length(k) + 2); f = 1; exit }
                       END { if (!f) exit 1 }' "$UCI_DB" || return 1
      ;;
    delete)
      awk -v k="$arg" 'index($0, k "=") != 1' "$UCI_DB" > "$UCI_DB.t"
      mv "$UCI_DB.t" "$UCI_DB" ;;
    commit) : ;;
  esac
  return 0
}
`;

function runDrop(files, fixture, { iconDir = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "aurora-drop-"));
  const iconPath = join(dir, "images");
  if (iconDir) {
    execFileSync("mkdir", ["-p", iconPath]);
    for (const name of files) writeFileSync(join(iconPath, name), "x");
  }
  const db = join(dir, "uci.db");
  writeFileSync(db, fixture.join("\n") + "\n");
  try {
    execFileSync(
      "sh",
      [
        "-c",
        `ICON_PATH="${iconPath}"\n` +
          UCI_STUB +
          slice("drop_missing_toolbar_icons") +
          "\ndrop_missing_toolbar_icons\n",
      ],
      { encoding: "utf8", env: { ...process.env, UCI_DB: db } },
    );
    return readFileSync(db, "utf8").split("\n").filter(Boolean).sort();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("an icon whose bytes never landed is cleared, not left as a dead name", () => {
  const uci = runDrop(
    ["hub-tb-abcdef012345.png", "overview.svg"],
    [
      "aurora.@toolbar_item[0]=toolbar_item",
      "aurora.@toolbar_item[0].icon=hub-tb-abcdef012345.png",
      "aurora.@toolbar_item[1]=toolbar_item",
      // 作者机器上的文件名，本机没有这张图
      "aurora.@toolbar_item[1].icon=authors-icon.png",
      "aurora.@toolbar_item[2]=toolbar_item",
      "aurora.@toolbar_item[2].icon=overview.svg",
    ],
  );

  assert.deepEqual(uci, [
    "aurora.@toolbar_item[0]=toolbar_item",
    "aurora.@toolbar_item[0].icon=hub-tb-abcdef012345.png",
    "aurora.@toolbar_item[1]=toolbar_item",
    "aurora.@toolbar_item[2]=toolbar_item",
    "aurora.@toolbar_item[2].icon=overview.svg",
  ].sort());
});

test("a path-traversal icon name is cleared without being stat'ed", () => {
  const uci = runDrop(
    [],
    [
      "aurora.@toolbar_item[0]=toolbar_item",
      "aurora.@toolbar_item[0].icon=../../etc/passwd",
    ],
  );
  assert.deepEqual(uci, ["aurora.@toolbar_item[0]=toolbar_item"]);
});

test("no image directory at all means the theme package is missing, not that every icon is dead", () => {
  const fixture = [
    "aurora.@toolbar_item[0]=toolbar_item",
    "aurora.@toolbar_item[0].icon=overview.svg",
  ];
  assert.deepEqual(runDrop([], fixture, { iconDir: false }), [...fixture].sort());
});

// ---------------------------------------------------------------------------
// 接线
// ---------------------------------------------------------------------------

const codeOnly = (text) =>
  text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

test("apply_theme_preset replaces the shortcut sections the way hub apply does", () => {
  const start = rpcd.indexOf('"apply_theme_preset")');
  const branch = codeOnly(rpcd.slice(start, rpcd.indexOf('"export_config")', start)));

  assert.match(branch, /load_preset_toolbar "\$template"/);
  assert.match(branch, /delete aurora\.@toolbar_item\[0\]/);
  assert.match(branch, /add aurora toolbar_item/);
  assert.ok(
    branch.indexOf("delete aurora.@toolbar_item[0]") <
      branch.indexOf("add aurora toolbar_item"),
    "先删光再重建，否则预设的快捷方式会叠在上一个主题的后面",
  );
});

// `uci batch` 会把 `add` 新建的匿名 section 名(cfg0686e6…)打到 stdout 上。
// apply_theme_preset 是同步 handler,它的 stdout 就是 ubus 的应答体 —— 那几行
// 名字排在 `{ "result": 0 }` 前面,rpcd 解析 JSON 失败,回 INVALID_ARGUMENT,
// 前端于是报「应用失败：未知」,而配置其实已经 commit 了。
test("every uci batch swallows its stdout, or the section names land in the JSON reply", () => {
  const lines = rpcd.split("\n");
  const offenders = lines
    .map((line, i) => ({ line, no: i + 1 }))
    .filter(({ line }) => /\|\s*uci batch\b/.test(line) && !/^\s*#/.test(line))
    .filter(({ line }) => !/\|\s*uci batch\s+[^|]*>\s*\/dev\/null/.test(line));

  assert.deepEqual(
    offenders.map(({ no }) => no),
    [],
    `uci batch 未吞掉 stdout(行 ${offenders.map((o) => o.no).join(", ")})`,
  );
});

test("hub apply drops dead icons after the icon assets have landed", () => {
  const worker = codeOnly(slice("hub_apply_worker"));
  assert.ok(
    worker.indexOf("apply_hub_toolbar_icon") < worker.indexOf("drop_missing_toolbar_icons"),
    "抢在资产步前面跑，会把还没落地的图标全清掉",
  );
  assert.ok(
    worker.indexOf("drop_missing_toolbar_icons") < worker.indexOf("record_active_source"),
  );
});

test("the sharing side still ships every icon name, so both ends number alike", () => {
  // 分享端一旦因为「传不了」省掉某个名字，接收端 nth_custom_toolbar_icon 数出
  // 来的序号就整体左移，后面的图标全部张冠李戴。兜底只能在接收端。
  const fn = slice("build_share_payload");
  assert.match(fn, /\[ -n "\$icon" \] && json_add_string "icon" "\$icon"/);
});
