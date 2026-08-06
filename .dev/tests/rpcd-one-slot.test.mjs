import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { repo } from "./paths.mjs";

const RPCD = repo("root/usr/libexec/rpcd/luci.aurora");
const rpcd = readFileSync(RPCD, "utf8");
const acl = readFileSync(
  repo("root/usr/share/rpcd/acl.d/luci-app-aurora.json"),
  "utf8",
);

// 把待测函数从脚本里切出来单跑:整份脚本依赖 jshn 和 uci,两者都只存在于
// OpenWrt 上。切片 + 打桩测的是「这个函数拿什么、扔掉什么、按什么顺序」,而
// 不是「源码长什么样」—— 排序和过滤这类逻辑,文本断言根本抓不住。
function slice(name) {
  const start = rpcd.indexOf(`${name}() {`);
  assert.ok(start !== -1, `${name} not found in rpcd script`);
  const end = rpcd.indexOf("\n}\n", start) + 3;
  return rpcd.slice(start, end);
}

// md5sum 是 busybox 自带的,macOS 上没有;用 cksum 替身。测的是喂进哈希前的那
// 串东西是否稳定,哈希算法本身不是被测对象。
const HASH_STUB = `md5sum() { cksum; }\n`;

// uci 的最小替身:show 打印固定夹具,get 从夹具里查,set/commit 记到 $UCI_LOG。
const UCI_STUB = `
uci() {
  case "$2" in
    show)   printf '%s' "$UCI_OUT" ;;
    get)    printf '%s' "$UCI_OUT" | sed -n "s/^$3='\\(.*\\)'\\$/\\1/p" ;;
    set)    printf 'SET %s\\n' "$3" >> "$UCI_LOG" ;;
    commit) printf 'COMMIT\\n' >> "$UCI_LOG" ;;
  esac
}
`;

const BASE =
  [
    "aurora.theme.light_bg='#ffffff'",
    "aurora.theme.dark_bg='#101114'",
    "aurora.theme.nav_type='sidebar'",
    "aurora.theme.struct_font_sans='\"Nunito\", sans-serif'",
    "aurora.theme.struct_font_mono='ui-monospace'",
    "aurora.theme.struct_spacing='0.3rem'",
    "aurora.theme.struct_radius_base='0.875rem'",
    "aurora.theme.struct_content_width_centered='92rem'",
    "aurora.theme.toolbar_enabled='1'",
  ].join("\n") + "\n";

function runFingerprint(uciShowOutput) {
  const script =
    `uci() { printf '%s' "$UCI_OUT"; }\n` +
    HASH_STUB +
    slice("theme_fingerprint") +
    "\ntheme_fingerprint\n";
  return execFileSync("sh", ["-c", script], {
    encoding: "utf8",
    env: { ...process.env, UCI_OUT: uciShowOutput },
  }).trim();
}

function runShell(body, uciShowOutput) {
  const dir = mkdtempSync(join(tmpdir(), "aurora-one-slot-"));
  const log = join(dir, "uci.log");
  const script =
    `UCI_LOG="${log}"\n: > "$UCI_LOG"\n` +
    UCI_STUB +
    HASH_STUB +
    slice("theme_fingerprint") +
    slice("normalize_preset_name") +
    slice("theme_modified") +
    slice("ensure_active_source") +
    slice("record_active_source") +
    body +
    `\ncat "$UCI_LOG"\n`;
  try {
    return execFileSync("sh", ["-c", script], {
      encoding: "utf8",
      env: { ...process.env, UCI_OUT: uciShowOutput },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// theme_fingerprint

test("theme_fingerprint: uci 输出顺序不影响结果", () => {
  const shuffled = BASE.trim().split("\n").reverse().join("\n") + "\n";
  assert.equal(runFingerprint(BASE), runFingerprint(shuffled));
});

test("theme_fingerprint: 簿记项与资产项不进指纹", () => {
  const noise =
    BASE +
    [
      "aurora.theme.active_source='hub:abc'",
      "aurora.theme.active_fingerprint='deadbeef'",
      "aurora.theme.active_preset='sage-green'",
      "aurora.theme.hub_applied='test'",
      "aurora.theme.icon_cache_version='1754400000'",
      "aurora.theme.hub_key_saved='1'",
      "aurora.theme.logo_svg='logo.svg'",
      "aurora.theme.favicon_png='favicon.png'",
      "aurora.theme.struct_login_bg='url(/x.png)'",
    ].join("\n") +
    "\n";
  assert.equal(runFingerprint(BASE), runFingerprint(noise));
});

test("theme_fingerprint: 外观键任何一项变化都改变指纹", () => {
  const base = runFingerprint(BASE);
  for (const [from, to] of [
    ["light_bg='#ffffff'", "light_bg='#fefefe'"],
    ["dark_bg='#101114'", "dark_bg='#000000'"],
    ["nav_type='sidebar'", "nav_type='mega-menu'"],
    ["struct_spacing='0.3rem'", "struct_spacing='0.5rem'"],
    ["struct_radius_base='0.875rem'", "struct_radius_base='0rem'"],
    [
      "struct_content_width_centered='92rem'",
      "struct_content_width_centered='80rem'",
    ],
    ["toolbar_enabled='1'", "toolbar_enabled='0'"],
    ["struct_font_mono='ui-monospace'", "struct_font_mono='Menlo'"],
  ]) {
    assert.notEqual(
      runFingerprint(BASE.replace(from, to)),
      base,
      `${from} 未改变指纹`,
    );
  }
});

test("theme_fingerprint: toolbar_item 段不进指纹", () => {
  // 用户加一个快捷方式不该被判成「改过主题」—— 预设根本没碰它。
  const withItems =
    BASE +
    "aurora.@toolbar_item[0].title='Luci'\naurora.@toolbar_item[0].url='/x'\n";
  assert.equal(runFingerprint(BASE), runFingerprint(withItems));
});

// ---------------------------------------------------------------------------
// theme_modified / ensure_active_source / record_active_source

test("theme_modified: 指纹相符时返回 1（不是我的）", () => {
  const uci = BASE + `aurora.theme.active_fingerprint='${runFingerprint(BASE)}'\n`;
  assert.match(runShell(`theme_modified && echo MINE || echo THEIRS`, uci), /THEIRS/);
});

test("theme_modified: 指纹不符时返回 0（是我的）", () => {
  const uci = BASE + "aurora.theme.active_fingerprint='0000000000000000'\n";
  assert.match(runShell(`theme_modified && echo MINE || echo THEIRS`, uci), /MINE/);
});

test("theme_modified: 没有记录指纹时判为「我的」", () => {
  assert.match(runShell(`theme_modified && echo MINE || echo THEIRS`, BASE), /MINE/);
});

test("ensure_active_source: 已有值时什么都不写", () => {
  const uci = BASE + "aurora.theme.active_source='hub:abc123'\n";
  assert.doesNotMatch(runShell(`ensure_active_source`, uci), /SET/);
});

test("ensure_active_source: 老配置带 active_preset 时迁成 builtin: 并补指纹", () => {
  const uci = BASE + "aurora.theme.active_preset='sage-green'\n";
  const out = runShell(`ensure_active_source`, uci);
  assert.match(out, /SET aurora\.theme\.active_source=builtin:sage-green/);
  assert.match(out, /SET aurora\.theme\.active_fingerprint=\S/);
  assert.match(out, /COMMIT/);
});

test("ensure_active_source: classic 归一成 default", () => {
  const uci = BASE + "aurora.theme.active_preset='classic'\n";
  assert.match(
    runShell(`ensure_active_source`, uci),
    /SET aurora\.theme\.active_source=builtin:default/,
  );
});

test("ensure_active_source: 什么都没有时落到 builtin:default", () => {
  assert.match(
    runShell(`ensure_active_source`, BASE),
    /SET aurora\.theme\.active_source=builtin:default/,
  );
});

test("ensure_active_source: 老配置带 hub_applied 时降级为 mine 且清空指纹", () => {
  // hub_applied 只存名字不存 id,反查不到商店条目。降级成 mine + 空指纹是正确
  // 的:那确实是一份不对应任何卡的配置,它会显示为「我的配置」并持有钩子。
  const uci = BASE + "aurora.theme.hub_applied='test'\n";
  const out = runShell(`ensure_active_source`, uci);
  assert.match(out, /SET aurora\.theme\.active_source=mine/);
  assert.match(out, /SET aurora\.theme\.active_fingerprint=\s*$/m);
});

test("record_active_source: 写来源与当前指纹，一次 commit", () => {
  const out = runShell(`record_active_source "hub:abc123"`, BASE);
  assert.match(out, /SET aurora\.theme\.active_source=hub:abc123/);
  assert.match(out, /SET aurora\.theme\.active_fingerprint=\S/);
  assert.match(out, /COMMIT/);
});

// ---------------------------------------------------------------------------
// backup_if_mine

function runBackup(uciShowOutput) {
  const dir = mkdtempSync(join(tmpdir(), "aurora-backup-"));
  const deviceDir = join(dir, "device");
  const configFile = join(dir, "aurora.conf");
  mkdirSync(deviceDir);
  mkdirSync(join(deviceDir, "pre-hub-images"));
  writeFileSync(join(deviceDir, "pre-hub-images", "logo.svg"), "old-logo");
  writeFileSync(configFile, "config theme 'theme'\n");
  const script =
    `DEVICE_DIR="${deviceDir}"\nCONFIG_FILE="${configFile}"\n` +
    `uci() { case "$2" in show) printf '%s' "$UCI_OUT" ;; get) printf '%s' "$UCI_OUT" | sed -n "s/^$3='\\(.*\\)'\\$/\\1/p" ;; esac; }\n` +
    HASH_STUB +
    slice("theme_fingerprint") +
    slice("theme_modified") +
    slice("backup_if_mine") +
    `\nbackup_if_mine\necho "TAKEN=$THEME_BACKUP_TAKEN"\n`;
  const out = execFileSync("sh", ["-c", script], {
    encoding: "utf8",
    env: { ...process.env, UCI_OUT: uciShowOutput },
  });
  const result = {
    taken: /TAKEN=1/.test(out),
    confExists: existsSync(join(deviceDir, "pre-hub-backup.conf")),
    imagesExist: existsSync(join(deviceDir, "pre-hub-images", "logo.svg")),
  };
  rmSync(dir, { recursive: true, force: true });
  return result;
}

test("backup_if_mine: 配置是我的时候留底，并清空上一次的图片备份", () => {
  const r = runBackup(BASE + "aurora.theme.active_fingerprint='0000'\n");
  assert.equal(r.taken, true);
  assert.equal(r.confExists, true);
  assert.equal(r.imagesExist, false, "旧图片备份必须清掉,否则回滚会拿到上上次的图");
});

test("backup_if_mine: 配置来自商店时不留底，且原封不动保住已有备份", () => {
  // 这一条是整个「一个槽位」能成立的关键:在商店里连点几个主题试看,你自己那
  // 份配置必须一直留在备份槽里。
  const fp = runFingerprint(BASE);
  const r = runBackup(BASE + `aurora.theme.active_fingerprint='${fp}'\n`);
  assert.equal(r.taken, false);
  assert.equal(r.confExists, false);
  assert.equal(r.imagesExist, true, "别人的主题不该冲掉你自己的图片备份");
});

// ---------------------------------------------------------------------------
// apply 路径接线

test("rpcd script: 两条 apply 路径都过 backup_if_mine，且旧的无条件 cp 已经消失", () => {
  assert.match(rpcd, /hub_apply_worker\(\)[\s\S]*?backup_if_mine/);
  assert.match(rpcd, /"apply_theme_preset"\)[\s\S]*?backup_if_mine/);
  // 断言范围是 worker 自己:backup_if_mine 内部当然还有那行 cp,它现在是有
  // 条件的那一份。
  assert.doesNotMatch(
    slice("hub_apply_worker"),
    /cp "\$CONFIG_FILE" "\$DEVICE_DIR\/pre-hub-backup\.conf"/,
    "worker 里的无条件备份必须由 backup_if_mine 取代",
  );
});

test("rpcd script: apply_hub_asset 的图片备份受 THEME_BACKUP_TAKEN 闸门约束", () => {
  assert.match(slice("apply_hub_asset"), /THEME_BACKUP_TAKEN/);
});

test("rpcd script: 两条 apply 路径都在成功收尾时记录来源", () => {
  assert.match(rpcd, /record_active_source "hub:\$id"/);
  assert.match(rpcd, /record_active_source "builtin:\$name"/);
});

test("rpcd script: 指纹在资产落盘之后才记录", () => {
  // 顺序是正确性的一部分:hub 的资产是在色值那批 uci batch 之后单独 commit 的,
  // 指纹若抢在前面算,刚应用完的主题立刻就会读回「已修改」。
  const worker = slice("hub_apply_worker");
  assert.ok(
    worker.indexOf("apply_hub_asset") < worker.indexOf("record_active_source"),
    "record_active_source 必须排在资产应用之后",
  );
});

// ---------------------------------------------------------------------------
// json_add_config_preview / hub_local_state

const JSHN_STUBS = `
json_add_object()  { echo "OBJ $1"; }
json_close_object(){ echo "/OBJ"; }
json_add_string()  { echo "STR $1=$2"; }
`;

const PREVIEW_UCI =
  "aurora.theme.light_bg='#ffffff'\n" +
  "aurora.theme.dark_bg='#101114'\n" +
  "aurora.theme.nav_type='sidebar'\n" +
  "aurora.theme.struct_spacing='0.3rem'\n" +
  "aurora.theme.struct_radius_base='0.875rem'\n" +
  "aurora.theme.struct_content_width_centered='92rem'\n" +
  "aurora.theme.toolbar_enabled='1'\n" +
  "aurora.theme.struct_font_sans='\"Nunito\", sans-serif'\n" +
  "aurora.theme.struct_font_mono='ui-monospace'\n";

function runConfigPreview() {
  const dir = mkdtempSync(join(tmpdir(), "aurora-preview-"));
  const conf = join(dir, "saved.conf");
  writeFileSync(conf, "config theme 'theme'\n");
  // uci -c <dir> show/get 的替身:show 吐夹具,get 从夹具里查。
  const script =
    `uci() {
  case "$4" in
    show) printf '%s' "$UCI_OUT" ;;
    get)  printf '%s' "$UCI_OUT" | sed -n "s/^$5='\\(.*\\)'\\$/\\1/p" ;;
  esac
}\n` +
    JSHN_STUBS +
    slice("json_add_config_preview") +
    `\njson_add_config_preview "${conf}"\n`;
  const out = execFileSync("sh", ["-c", script], {
    encoding: "utf8",
    env: { ...process.env, UCI_OUT: PREVIEW_UCI },
  });
  rmSync(dir, { recursive: true, force: true });
  return out;
}

test("json_add_config_preview: 投影出 colors/layout/typography 三段", () => {
  const out = runConfigPreview();
  assert.match(out, /OBJ colors/);
  assert.match(out, /STR light_bg=#ffffff/);
  assert.match(out, /STR dark_bg=#101114/);
  assert.match(out, /OBJ layout/);
  assert.match(out, /STR nav_type=sidebar/);
  assert.match(out, /STR struct_radius_base=0\.875rem/);
  assert.match(out, /OBJ typography/);
  assert.match(out, /STR struct_font_mono=ui-monospace/);
});

test("json_add_config_preview: 带空格的字体栈完整保留", () => {
  // 抓的是词分割陷阱:字体栈里有空格,绝不能走 $(...) 展开。
  assert.match(
    runConfigPreview(),
    /STR struct_font_sans="Nunito", sans-serif/,
  );
});

test("json_add_config_preview: jshn 写入没有掉进管道子 shell", () => {
  // 若颜色循环写成 `... | while read`,循环体在子 shell 里跑,退出后这些
  // json_add_string 全部丢失 —— 输出里就只剩空的 OBJ colors / /OBJ。
  const out = runConfigPreview();
  const block = out.slice(out.indexOf("OBJ colors"), out.indexOf("/OBJ"));
  assert.ok(block.includes("STR light_bg"), "颜色写入丢失:循环跑在子 shell 里");
});

test("rpcd script: hub_local_state 已声明且过 ensure_active_source", () => {
  assert.match(rpcd, /json_add_object "hub_local_state"; json_close_object/);
  assert.match(rpcd, /"hub_local_state"\)[\s\S]*?ensure_active_source/);
  assert.match(rpcd, /"hub_local_state"\)[\s\S]*?json_add_boolean "modified"/);
});

test("acl: hub_local_state 在 read 列表里", () => {
  assert.match(acl, /"hub_local_state"/);
});
