import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { repo } from "./paths.mjs";

// 应用一个主题 = 穿上它那一套,而不是它那一套外加上一个主题的壁纸和 logo。
// 这一组守的是「交接」那一步:上个主题带进来的资产被清掉,用户自己上传的
// 原封不动留下。归属只看文件名形状,所以判定本身也在这里钉死。

const rpcd = readFileSync(repo("root/usr/libexec/rpcd/luci.aurora"), "utf8");

function slice(name) {
  const start = rpcd.indexOf(`${name}() {`);
  assert.ok(start !== -1, `${name} not found in rpcd script`);
  const end = rpcd.indexOf("\n}\n", start) + 3;
  return rpcd.slice(start, end);
}

// uci 的最小替身,带状态:get 查库,set/delete 改库,commit 记一笔。被测的正是
// 「哪些键留下、哪些键消失」,只记调用日志的无状态桩答不了这个问题。
// 旗标位置不固定:清理走 \`uci -q get\`,而 sweep 走 \`uci show aurora\`。按位置取
// 参数的桩会在后者上静默失灵,给出一份空的 live 名单 —— 那会让 sweep 的断言
// 变成永远成立。所以跳过所有 -* 再取动词,同 rpcd-share-assets 的桩。
const UCI_STUB = `
uci() {
  cmd=""; arg=""
  for a in "$@"; do
    case "$a" in -*) continue ;; esac
    if [ -z "$cmd" ]; then cmd="$a"; else arg="$a"; break; fi
  done
  case "$cmd" in
    get)
      v=$(grep "^\${arg}=" "$UCI_DB" | head -1 | cut -d= -f2-)
      [ -n "$v" ] || return 1
      printf '%s\\n' "$v"
      ;;
    delete)
      grep -v "^\${arg}=" "$UCI_DB" > "$UCI_DB.t"; mv "$UCI_DB.t" "$UCI_DB" ;;
    set)
      k="\${arg%%=*}"; v="\${arg#*=}"
      grep -v "^\${k}=" "$UCI_DB" > "$UCI_DB.t"; mv "$UCI_DB.t" "$UCI_DB"
      printf '%s=%s\\n' "$k" "$v" >> "$UCI_DB" ;;
    commit) printf 'COMMIT\\n' >> "$UCI_LOG" ;;
  esac
  return 0
}
`;

// 一次 apply 之后 uci 里剩下什么。fixture 是 "key=value" 行,返回同样的形状。
function runWithUci(fnSlices, call, fixture, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "aurora-handoff-"));
  const db = join(dir, "uci.db");
  const log = join(dir, "uci.log");
  writeFileSync(db, fixture.length ? fixture.join("\n") + "\n" : "");
  writeFileSync(log, "");
  try {
    execFileSync("sh", ["-c", UCI_STUB + fnSlices.join("\n") + "\n" + call], {
      encoding: "utf8",
      env: { ...process.env, UCI_DB: db, UCI_LOG: log, ...env },
    });
    return {
      uci: readFileSync(db, "utf8").split("\n").filter(Boolean).sort(),
      commits: readFileSync(log, "utf8").split("\n").filter(Boolean).length,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const CLEAR = [slice("is_hub_asset_name"), slice("clear_inherited_assets")];
const bgUrl = (name) => `url('/luci-static/aurora/images/${name}')`;

// ---------------------------------------------------------------------------
// is_hub_asset_name —— 归属判定,清理与回收共用的那一条
// ---------------------------------------------------------------------------

const shapeCases = [
  // apply_hub_asset 真会产出的七种前缀
  ["hub-logo-0123456789ab.svg", true],
  ["hub-favicon-0123456789ab.png", true],
  ["hub-app192-0123456789ab.png", true],
  ["hub-app512-0123456789ab.png", true],
  ["hub-login-bg-abcdef012345.jpg", true],
  ["hub-main-bg-abcdef012345.png", true],
  ["hub-tb-abcdef012345.png", true],
  // 用户自己上传的图,哪怕名字以 hub- 开头也不算 —— 误清就是数据丢失
  ["hub-wallpaper.png", false],
  ["hub-main-bg.png", false],
  ["my-photo.jpg", false],
  ["logo.svg", false],
  // 形状必须严丝合缝:12 位、全小写十六进制、三字符扩展名
  ["hub-main-bg-abcdef01234.png", false],
  ["hub-main-bg-abcdef0123456.png", false],
  ["hub-main-bg-ABCDEF012345.png", false],
  ["hub-main-bg-abcdefg12345.png", false],
  ["hub-main-bg-abcdef012345.jpeg", false],
  ["", false],
];

test("is_hub_asset_name only accepts the shape apply_hub_asset produces", () => {
  for (const [name, expected] of shapeCases) {
    const out = execFileSync(
      "sh",
      [
        "-c",
        slice("is_hub_asset_name") +
          `\nis_hub_asset_name "${name}" && echo YES || echo NO\n`,
      ],
      { encoding: "utf8" },
    ).trim();
    assert.equal(out, expected ? "YES" : "NO", `${name || "(empty)"}`);
  }
});

test("sweep_hub_images asks is_hub_asset_name rather than re-deriving the shape", () => {
  const sweep = slice("sweep_hub_images");
  assert.match(sweep, /is_hub_asset_name "\$name" \|\| continue/);
  assert.equal(
    /\[0-9a-f\]\[0-9a-f\]/.test(sweep),
    false,
    "the hex shape must live in exactly one place",
  );
});

// ---------------------------------------------------------------------------
// clear_inherited_assets —— 上个主题的资产被交还,用户自己的留下
// ---------------------------------------------------------------------------

test("a preset apply drops every image the previous theme brought", () => {
  const { uci } = runWithUci(CLEAR, 'clear_inherited_assets ""', [
    "aurora.theme.logo_svg=hub-logo-0123456789ab.svg",
    "aurora.theme.favicon_png=hub-favicon-0123456789ab.png",
    "aurora.theme.favicon_ico=hub-favicon-0123456789ab.ico",
    "aurora.theme.pwa_icon_192=hub-app192-0123456789ab.png",
    "aurora.theme.pwa_icon_512=hub-app512-0123456789ab.png",
    `aurora.theme.struct_main_bg=${bgUrl("hub-main-bg-abcdef012345.png")}`,
    "aurora.theme.struct_main_bg_lqip=data:image/png;base64,AA",
    "aurora.theme.struct_main_bg_alpha=90%",
    "aurora.theme.struct_main_bg_blur=8px",
    "aurora.theme.struct_main_bg_scrim=40%",
    `aurora.theme.struct_login_bg=${bgUrl("hub-login-bg-abcdef012345.jpg")}`,
    "aurora.theme.struct_login_bg_alpha=60%",
    "aurora.theme.nav_type=sidebar",
  ]);

  // 外观本身(nav_type)不归它管,一个字都不能动
  assert.deepEqual(uci, ["aurora.theme.nav_type=sidebar"]);
});

test("images the user uploaded survive a theme switch, tunables included", () => {
  const fixture = [
    "aurora.theme.logo_svg=my-logo.svg",
    `aurora.theme.struct_main_bg=${bgUrl("my-wallpaper.jpg")}`,
    "aurora.theme.struct_main_bg_lqip=data:image/png;base64,AA",
    // 用户自己拉过的滑杆:图是他的,亮度也是他的
    "aurora.theme.struct_main_bg_alpha=95%",
    "aurora.theme.struct_main_bg_blur=4px",
  ];
  const { uci, commits } = runWithUci(CLEAR, 'clear_inherited_assets ""', fixture);

  assert.deepEqual(uci, [...fixture].sort());
  assert.equal(commits, 0, "nothing changed, so nothing may be committed");
});

test("a slot this apply just wrote is never cleared", () => {
  const { uci } = runWithUci(CLEAR, 'clear_inherited_assets "logo_svg main_bg"', [
    "aurora.theme.logo_svg=hub-logo-0123456789ab.svg",
    `aurora.theme.struct_main_bg=${bgUrl("hub-main-bg-abcdef012345.png")}`,
    "aurora.theme.struct_main_bg_alpha=90%",
    // 这一份 payload 没带登录背景 —— 它还是上一个主题的
    `aurora.theme.struct_login_bg=${bgUrl("hub-login-bg-abcdef012345.jpg")}`,
    "aurora.theme.struct_login_bg_blur=12px",
  ]);

  assert.deepEqual(uci, [
    `aurora.theme.struct_main_bg=${bgUrl("hub-main-bg-abcdef012345.png")}`,
    "aurora.theme.struct_main_bg_alpha=90%",
    "aurora.theme.logo_svg=hub-logo-0123456789ab.svg",
  ].sort());
});

// ---------------------------------------------------------------------------
// clear + sweep 串起来:报上来的那个现象,以及它旁边那条不能误伤的线
// ---------------------------------------------------------------------------

// 预设那条路径的真实两步:先交还槽位,再回收没人指着的文件。分开测各自成立,
// 串起来才回答「屏幕上还有没有那张背景、overlay 上还剩不剩那个文件」。
function runPresetHandoff(files, fixture) {
  const dir = mkdtempSync(join(tmpdir(), "aurora-handoff-e2e-"));
  const iconPath = join(dir, "images");
  const deviceDir = join(dir, "device");
  mkdirSync(iconPath, { recursive: true });
  mkdirSync(deviceDir, { recursive: true });
  const db = join(dir, "uci.db");
  writeFileSync(db, fixture.join("\n") + "\n");
  writeFileSync(join(dir, "uci.log"), "");
  for (const name of files) writeFileSync(join(iconPath, name), "x");

  // sweep 读的是 `uci -q show aurora`(为了拿快捷方式的图标),而清理走的是
  // get/delete —— 同一个库两种读法。show 由库现场拼出来,否则测的就是两份彼此
  // 不同步的状态,sweep 会拿到一份空的 live 名单然后把什么都删掉。
  // uci show 的行是 key='value';sweep 的 sed 认的正是那对引号。%c/39 拼引号,
  // 免得在 sh -c 里套三层引号。
  const stub = UCI_STUB.replace(
    '  case "$cmd" in',
    `  case "$cmd" in
    show) awk '{ i=index($0,"="); printf "%s=%c%s%c\\n", substr($0,1,i-1), 39, substr($0,i+1), 39 }' "$UCI_DB" ;;`,
  );

  execFileSync(
    "sh",
    [
      "-c",
      `ICON_PATH="${iconPath}"\nDEVICE_DIR="${deviceDir}"\n` +
        stub +
        slice("is_hub_asset_name") +
        slice("clear_inherited_assets") +
        slice("sweep_hub_images") +
        '\nclear_inherited_assets ""\nsweep_hub_images\n',
    ],
    {
      encoding: "utf8",
      env: { ...process.env, UCI_DB: db, UCI_LOG: join(dir, "uci.log") },
    },
  );

  const result = {
    uci: readFileSync(db, "utf8").split("\n").filter(Boolean).sort(),
    files: readdirSync(iconPath).sort(),
  };
  rmSync(dir, { recursive: true, force: true });
  return result;
}

test("the reported bug: a store background does not survive into a preset", () => {
  const { uci, files } = runPresetHandoff(
    ["hub-main-bg-abcdef012345.png"],
    [
      `aurora.theme.struct_main_bg=${bgUrl("hub-main-bg-abcdef012345.png")}`,
      "aurora.theme.struct_main_bg_alpha=90%",
      "aurora.theme.struct_main_bg_blur=8px",
      "aurora.theme.nav_type=sidebar",
    ],
  );

  assert.deepEqual(uci, ["aurora.theme.nav_type=sidebar"]);
  assert.deepEqual(files, [], "槽位空了,那张图就是垃圾,不能留在 overlay 上");
});

test("a hub image a shortcut still points at is not swept", () => {
  // 快捷方式不归 clear 管(预设对它们没有主张),所以它的图标必须活下来 ——
  // 同时这条也证明 sweep 真的读到了 live 名单,而不是拿着一份空名单乱删。
  const { files } = runPresetHandoff(
    ["hub-tb-abcdef012345.png", "hub-logo-0123456789ab.svg"],
    [
      "aurora.theme.logo_svg=hub-logo-0123456789ab.svg",
      "aurora.@toolbar_item[0].icon=hub-tb-abcdef012345.png",
    ],
  );

  assert.deepEqual(files, ["hub-tb-abcdef012345.png"]);
});

test("the wallpaper the user uploaded is not collateral damage", () => {
  const { uci, files } = runPresetHandoff(
    ["my-wallpaper.jpg", "hub-logo-0123456789ab.svg"],
    [
      `aurora.theme.struct_main_bg=${bgUrl("my-wallpaper.jpg")}`,
      "aurora.theme.struct_main_bg_alpha=95%",
      "aurora.theme.logo_svg=hub-logo-0123456789ab.svg",
    ],
  );

  assert.deepEqual(uci, [
    `aurora.theme.struct_main_bg=${bgUrl("my-wallpaper.jpg")}`,
    "aurora.theme.struct_main_bg_alpha=95%",
  ].sort());
  // 用户自己的图留着;上一个主题的 logo 连槽位带文件一起走
  assert.deepEqual(files, ["my-wallpaper.jpg"]);
});

// ---------------------------------------------------------------------------
// apply_hub_bg_tunables —— 调参跟着图走
// ---------------------------------------------------------------------------

const TUNABLES = [slice("apply_hub_bg_tunables")];

const payloadTunables = [
  "struct_main_bg_alpha=80%",
  "struct_main_bg_blur=",
  "struct_main_bg_scrim=30%",
  "struct_login_bg_alpha=",
  "struct_login_bg_blur=",
  "struct_login_bg_scrim=",
].join("\n");

test("the landed background takes the author's tunables, missing ones reset", () => {
  const { uci } = runWithUci(
    TUNABLES,
    'HUB_BG_TUNABLES="$FIXTURE_TUNABLES"\napply_hub_bg_tunables "main_bg"',
    [
      "aurora.theme.struct_main_bg_alpha=95%",
      // 作者没调过 blur:该回到 CSS 默认,而不是继承上一个主题的值
      "aurora.theme.struct_main_bg_blur=40px",
    ],
    { FIXTURE_TUNABLES: payloadTunables },
  );

  assert.deepEqual(uci, [
    "aurora.theme.struct_main_bg_alpha=80%",
    "aurora.theme.struct_main_bg_scrim=30%",
  ].sort());
});

test("a theme with no background of its own leaves the user's tunables alone", () => {
  const fixture = [
    "aurora.theme.struct_main_bg_alpha=95%",
    "aurora.theme.struct_login_bg_blur=12px",
  ];
  const { uci, commits } = runWithUci(
    TUNABLES,
    'HUB_BG_TUNABLES="$FIXTURE_TUNABLES"\napply_hub_bg_tunables ""',
    fixture,
    { FIXTURE_TUNABLES: payloadTunables },
  );

  assert.deepEqual(uci, [...fixture].sort());
  assert.equal(commits, 0);
});

// ---------------------------------------------------------------------------
// 两条 apply 路径的接线与顺序
// ---------------------------------------------------------------------------

// 注释里提到某个函数名不等于调用了它 —— 顺序断言只看代码行。
const codeOnly = (text) =>
  text
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");

test("validate_and_apply_hub_payload parks the tunables instead of batching them", () => {
  const fn = slice("validate_and_apply_hub_payload");
  assert.match(fn, /HUB_BG_TUNABLES="\$HUB_BG_TUNABLES\$key=\$value/);
  assert.equal(
    /delete aurora\.theme\.%s\\n" "\$key" >> "\$batch_file"/.test(fn),
    false,
    "tunables must not be reset before the asset step knows what landed",
  );
});

test("hub apply settles the assets before it fingerprints the result", () => {
  const worker = codeOnly(slice("hub_apply_worker"));
  const tunables = worker.indexOf("apply_hub_bg_tunables");
  const clear = worker.indexOf("clear_inherited_assets");
  const sweep = worker.indexOf("sweep_hub_images");
  const record = worker.indexOf("record_active_source");

  assert.ok(tunables !== -1 && clear !== -1);
  assert.ok(tunables < clear, "tunables are written before the slots are cleared");
  assert.ok(clear < sweep, "clearing frees the slots that sweeping then collects");
  assert.ok(sweep < record, "the fingerprint must be taken last");
  assert.match(worker, /landed="\$landed\$a_kind "/);
});

test("apply_theme_preset hands back every asset the previous theme brought", () => {
  const start = rpcd.indexOf('"apply_theme_preset")');
  assert.ok(start !== -1);
  const branch = codeOnly(
    rpcd.slice(start, rpcd.indexOf('"export_config")', start)),
  );

  const clear = branch.indexOf('clear_inherited_assets ""');
  const sweep = branch.indexOf("sweep_hub_images");
  const record = branch.indexOf("record_active_source");

  assert.ok(clear !== -1, "a preset carries no assets, so it clears them all");
  assert.ok(clear < sweep);
  assert.ok(
    sweep < record,
    "the tunables are in theme_fingerprint -- clearing must precede recording",
  );
});
