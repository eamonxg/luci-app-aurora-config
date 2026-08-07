import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { repo } from "./paths.mjs";

const rpcd = readFileSync(repo("root/usr/libexec/rpcd/luci.aurora"), "utf8");

// 同 rpcd-one-slot：把待测函数切出来单跑。整份脚本依赖 jshn 和 uci，两者都只
// 存在于 OpenWrt 上；而这一批测的全是排序、过滤和落盘这类文本断言抓不住的
// 行为——编号一旦两端算得不一样，接收方的图标就整体错位，而源码看上去毫无问题。
function slice(name) {
  const start = rpcd.indexOf(`${name}() {`);
  assert.ok(start !== -1, `${name} not found in rpcd script`);
  const end = rpcd.indexOf("\n}\n", start) + 3;
  return rpcd.slice(start, end);
}

function constant(name) {
  const match = rpcd.match(new RegExp(`^readonly ${name}=(.*)$`, "m"));
  assert.ok(match, `${name} not found`);
  return `readonly ${name}=${match[1]}\n`;
}

// uci 的替身。刻意不用 rpcd-one-slot 那个 sed 版本：section id 长
// `@toolbar_item[0]`，方括号在 sed 的正则里是字符类，那个替身查不到它。
const UCI_STUB = `
uci() {
  cmd=""; arg=""
  for a in "$@"; do
    case "$a" in -*) continue ;; esac
    if [ -z "$cmd" ]; then cmd="$a"; else arg="$a"; break; fi
  done
  case "$cmd" in
    show) printf '%s\\n' "$UCI_OUT" ;;
    get)
      v=$(printf '%s\\n' "$UCI_OUT" | grep -F "$arg=" | head -1 | sed "s/^[^=]*='//;s/'\\$//")
      [ -n "$v" ] || return 1
      printf '%s\\n' "$v"
      ;;
    set) printf 'SET %s\\n' "$arg" >> "$UCI_LOG" ;;
    commit) printf 'COMMIT\\n' >> "$UCI_LOG" ;;
  esac
}
`;

function runSh(script, env = {}) {
  return execFileSync("sh", ["-c", script], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

// ---------------------------------------------------------------------------
// sniff_image_ext —— 字节来自网络，扩展名来自字节
// ---------------------------------------------------------------------------

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const ICO = Buffer.from([0x00, 0x00, 0x01, 0x00, 1, 0, 0, 0]);

function sniff(bytes) {
  const dir = mkdtempSync(join(tmpdir(), "aurora-sniff-"));
  const file = join(dir, "asset");
  writeFileSync(file, bytes);
  const out = runSh(
    slice("sniff_image_ext") + `\nsniff_image_ext "${file}" || echo NONE\n`,
  ).trim();
  rmSync(dir, { recursive: true, force: true });
  return out;
}

test("sniff_image_ext: 按魔数认出四种格式，认不出就失败", () => {
  assert.equal(sniff(PNG), "png");
  assert.equal(sniff(JPEG), "jpg");
  assert.equal(sniff(ICO), "ico");
  assert.equal(sniff('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), "svg");
  assert.equal(sniff('<?xml version="1.0"?><svg></svg>'), "svg");
  // BOM + 前导空白都不该挡住 SVG —— 和 hub 的 isSvg 一样的姿态。
  assert.equal(sniff("\uFEFF\n  <svg></svg>"), "svg");
  assert.equal(sniff("not an image at all"), "NONE");
  assert.equal(sniff(Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0])), "NONE");
});

test("hub_asset_ext_ok: 每种 kind 只收它该收的格式", () => {
  const script =
    slice("hub_asset_ext_ok") +
    `\nfor pair in "$@"; do
      k=\${pair%%:*}; e=\${pair##*:}
      if hub_asset_ext_ok "$k" "$e"; then echo "$pair OK"; else echo "$pair NO"; fi
    done\n`;
  const cases = [
    "logo_svg:svg", "logo_svg:png",
    "favicon_png:png", "favicon_png:svg",
    "favicon_ico:ico", "favicon_ico:png",
    "pwa_icon_192:png", "pwa_icon_192:jpg",
    "login_bg:png", "login_bg:jpg", "login_bg:svg",
    "toolbar_icon_0:png", "toolbar_icon_11:svg", "toolbar_icon_0:ico",
    "font_sans:png",
  ];
  const out = runSh(`set -- ${cases.join(" ")}\n${script}`);
  const verdict = Object.fromEntries(
    out.trim().split("\n").map((line) => line.split(" ")),
  );
  assert.deepEqual(verdict, {
    "logo_svg:svg": "OK", "logo_svg:png": "NO",
    "favicon_png:png": "OK", "favicon_png:svg": "NO",
    "favicon_ico:ico": "OK", "favicon_ico:png": "NO",
    "pwa_icon_192:png": "OK", "pwa_icon_192:jpg": "NO",
    // 审核台把 login_bg 一律重编码成 PNG，但 JPEG 在 schema 里，两个都收。
    "login_bg:png": "OK", "login_bg:jpg": "OK", "login_bg:svg": "NO",
    "toolbar_icon_0:png": "OK", "toolbar_icon_11:svg": "OK", "toolbar_icon_0:ico": "NO",
    // 字体不走这条路，问到它就是调用方分流错了。
    "font_sans:png": "NO",
  });
});

// ---------------------------------------------------------------------------
// hub_asset_target_name —— 落地名不能再是出厂名
// ---------------------------------------------------------------------------

test("hub_asset_target_name: 全部 sha 派生且带 hub- 前缀，绝不落成出厂名", () => {
  const sha = "0123456789abcdef".repeat(4);
  const kinds = [
    "logo_svg", "favicon_png", "favicon_ico",
    "pwa_icon_192", "pwa_icon_512", "login_bg", "toolbar_icon_3",
  ];
  const script =
    slice("hub_asset_target_name") +
    `\nfor k in ${kinds.join(" ")}; do
       case "$k" in logo_svg) e=svg ;; favicon_ico) e=ico ;; *) e=png ;; esac
       hub_asset_target_name "$k" "${sha}" "$e"; echo
     done
     hub_asset_target_name "nonsense" "${sha}" png || echo UNKNOWN_REJECTED\n`;
  const names = runSh(script).trim().split("\n");

  assert.deepEqual(names, [
    "hub-logo-0123456789ab.svg",
    "hub-favicon-0123456789ab.png",
    "hub-favicon-0123456789ab.ico",
    "hub-app192-0123456789ab.png",
    "hub-app512-0123456789ab.png",
    "hub-login-bg-0123456789ab.png",
    "hub-tb-0123456789ab.png",
    "UNKNOWN_REJECTED",
  ]);

  // 这才是这次改动的要害：落地名若还是出厂名，一份从商店应用来的配置就再也
  // 分享不出它的 logo/favicon/PWA 图标 —— build_share_payload 会把它们当成
  // 「用户从没改过这个槽位」而跳过。
  const shipped = slice("is_theme_shipped_image");
  const check = runSh(
    shipped +
      `\nfor n in ${names.slice(0, -1).join(" ")}; do
         is_theme_shipped_image "$n" && echo "LEAK $n"
       done; echo DONE\n`,
  ).trim();
  assert.equal(check, "DONE", "落地名一旦撞上出厂名，二次分享就会静默丢图");
});

// ---------------------------------------------------------------------------
// nth_custom_toolbar_icon —— 两端必须算出同一个编号
// ---------------------------------------------------------------------------

function toolbarFixture(items) {
  const lines = [];
  items.forEach((item, i) => {
    lines.push(`aurora.@toolbar_item[${i}]=toolbar_item`);
    for (const [key, value] of Object.entries(item)) {
      lines.push(`aurora.@toolbar_item[${i}].${key}='${value}'`);
    }
  });
  return lines.join("\n");
}

function iconOrder(uciOut) {
  const script =
    constant("MAX_SHARED_TOOLBAR_ICONS") +
    UCI_STUB +
    slice("has_control_char") +
    slice("strip_control_chars") +
    slice("is_theme_shipped_image") +
    slice("toolbar_icon_custom") +
    slice("toolbar_item_shareable") +
    slice("nth_custom_toolbar_icon") +
    `\ni=0
     while [ "$i" -lt 20 ]; do
       nth_custom_toolbar_icon "$i" || break
       echo
       i=$((i + 1))
     done\n`;
  return runSh(script, { UCI_OUT: uciOut, UCI_LOG: "/dev/null" })
    .trim()
    .split("\n")
    .filter(Boolean);
}

const ok = (extra) => ({ title: "T", url: "/x", enabled: "1", ...extra });

test("nth_custom_toolbar_icon: 按首次出现顺序去重编号", () => {
  const order = iconOrder(
    toolbarFixture([
      ok({ icon: "alpha.png" }),
      ok({ icon: "beta.svg" }),
      ok({ icon: "alpha.png" }),
      ok({ icon: "gamma.png" }),
    ]),
  );
  assert.deepEqual(order, ["alpha.png", "beta.svg", "gamma.png"]);
});

test("nth_custom_toolbar_icon: 主题自带的图标不占编号", () => {
  // 这四个是 header.ut 默认工具栏用的，每台装了主题的设备上都有 —— 发过去
  // 纯属浪费，而更要命的是让它们占掉编号会让接收端的映射整体错位。
  const order = iconOrder(
    toolbarFixture([
      ok({ icon: "overview.svg" }),
      ok({ icon: "mine.png" }),
      ok({ icon: "system.svg" }),
      ok({ icon: "logo.svg" }),
      ok({ icon: "other.png" }),
    ]),
  );
  assert.deepEqual(order, ["mine.png", "other.png"]);
});

// 这条是整个方案的支点。分享端遍历的是**被接受的**快捷方式，接收端遍历的是
// payload.toolbar（也就是那些被接受的）。一条因为标题超长而被跳过的快捷方式，
// 它的图标若在分享端占掉一格，接收端就从那里往后全部错位——每个人的工具栏都
// 会挂上别人的图。
test("nth_custom_toolbar_icon: 被跳过的快捷方式不占编号", () => {
  const order = iconOrder(
    toolbarFixture([
      ok({ icon: "first.png" }),
      // 标题 31 字符：超出 hub 的 1-30，整条不发
      { title: "x".repeat(31), url: "/y", enabled: "1", icon: "skipped-a.png" },
      // url 没有 scheme 也不以 / 开头
      ok({ url: "nowhere", icon: "skipped-b.png" }),
      // 协议相对 url
      ok({ url: "//evil.example", icon: "skipped-c.png" }),
      // enabled 不是 0/1
      ok({ enabled: "yes", icon: "skipped-d.png" }),
      // 图标名超出字符集
      ok({ icon: "bad name.png" }),
      // 标题带单引号
      ok({ title: "it's", icon: "skipped-e.png" }),
      ok({ icon: "second.png" }),
    ]),
  );
  assert.deepEqual(order, ["first.png", "second.png"]);
});

test("nth_custom_toolbar_icon: 编号上限与分享端一致", () => {
  const many = [];
  for (let i = 0; i < 15; i++) many.push(ok({ icon: `icon${i}.png` }));
  const order = iconOrder(toolbarFixture(many));
  // 12 条快捷方式的上限先咬住，图标自然也只剩 12 个。
  assert.equal(order.length, 12);
  assert.equal(order[0], "icon0.png");
  assert.equal(order[11], "icon11.png");
});

test("nth_custom_toolbar_icon: 编号只看名字，不看本机有没有那个文件", () => {
  // 接收端算同一个编号时，那些文件在它机器上根本还不存在。这个判断一旦掺进
  // 「文件在不在、够不够小、格式对不对」，两端就再也算不出同一个数。
  const body = slice("nth_custom_toolbar_icon");
  assert.ok(
    !body.includes("toolbar_icon_uploadable"),
    "编号不能依赖只有分享端才答得出的问题",
  );
  assert.ok(!body.includes("ICON_PATH"), "编号不能碰本机文件");
});

// ---------------------------------------------------------------------------
// image_fits_share
// ---------------------------------------------------------------------------

test("image_fits_share: 边界正好是 hub 的 2 MiB", () => {
  const script =
    constant("MAX_SHARED_IMAGE") +
    slice("image_fits_share") +
    `\nfor s in "$@"; do
       if image_fits_share "$s"; then echo "$s YES"; else echo "$s NO"; fi
     done\n`;
  const out = runSh(`set -- 0 1 2097151 2097152 2097153 8388608\n${script}`);
  assert.deepEqual(
    out.trim().split("\n"),
    ["0 NO", "1 YES", "2097151 YES", "2097152 YES", "2097153 NO", "8388608 NO"],
  );
});

// ---------------------------------------------------------------------------
// restore_pre_hub_images / sweep_hub_images —— sha 名的代价必须被收干净
// ---------------------------------------------------------------------------

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "aurora-images-"));
  const iconPath = join(dir, "images");
  const deviceDir = join(dir, "device");
  mkdirSync(iconPath);
  mkdirSync(join(deviceDir, "pre-hub-images"), { recursive: true });
  return { dir, iconPath, deviceDir };
}

test("restore_pre_hub_images: 先删本次新引入的，再拷回被覆盖的", () => {
  const { dir, iconPath, deviceDir } = sandbox();
  const backup = join(deviceDir, "pre-hub-images");

  // 这次 apply 新引入的一张
  writeFileSync(join(iconPath, "hub-logo-aaaaaaaaaaaa.svg"), "theirs");
  writeFileSync(join(backup, "hub-logo-aaaaaaaaaaaa.svg.new"), "");
  // 这次 apply 覆盖掉的一张
  writeFileSync(join(iconPath, "hub-tb-bbbbbbbbbbbb.png"), "theirs");
  writeFileSync(join(backup, "hub-tb-bbbbbbbbbbbb.png"), "mine");
  // 与 hub 无关的一张，一个字节都不该动
  writeFileSync(join(iconPath, "my-own.png"), "untouched");

  runSh(
    `ICON_PATH="${iconPath}"\nDEVICE_DIR="${deviceDir}"\n` +
      slice("restore_pre_hub_images") +
      "\nrestore_pre_hub_images\n",
  );

  assert.equal(
    existsSync(join(iconPath, "hub-logo-aaaaaaaaaaaa.svg")),
    false,
    "新引入的必须删掉，否则回滚会把别人的图永远留在 overlay 上",
  );
  assert.equal(
    readFileSync(join(iconPath, "hub-tb-bbbbbbbbbbbb.png"), "utf8"),
    "mine",
  );
  assert.equal(readFileSync(join(iconPath, "my-own.png"), "utf8"), "untouched");
  assert.equal(existsSync(backup), false, "备份目录必须清掉");
  rmSync(dir, { recursive: true, force: true });
});

function runSweep(files, uciOut, backups = []) {
  const { dir, iconPath, deviceDir } = sandbox();
  for (const name of files) writeFileSync(join(iconPath, name), "x");
  for (const name of backups) writeFileSync(join(deviceDir, "pre-hub-images", name), "x");

  runSh(
    `ICON_PATH="${iconPath}"\nDEVICE_DIR="${deviceDir}"\n` +
      UCI_STUB +
      slice("sweep_hub_images") +
      "\nsweep_hub_images\n",
    { UCI_OUT: uciOut, UCI_LOG: "/dev/null" },
  );

  const left = readdirSync(iconPath).sort();
  rmSync(dir, { recursive: true, force: true });
  return left;
}

test("sweep_hub_images: 留下还被指着的，收走没人要的", () => {
  const left = runSweep(
    [
      "hub-logo-aaaaaaaaaaaa.svg",      // 被 logo_svg 指着
      "hub-login-bg-bbbbbbbbbbbb.png",  // 被 struct_login_bg 指着
      "hub-tb-cccccccccccc.png",        // 被某条快捷方式指着
      "hub-logo-dddddddddddd.svg",      // 上一次 apply 的遗留
      "hub-app192-eeeeeeeeeeee.png",    // 同上
    ],
    [
      "aurora.theme.logo_svg='hub-logo-aaaaaaaaaaaa.svg'",
      "aurora.theme.struct_login_bg='url('/luci-static/aurora/images/hub-login-bg-bbbbbbbbbbbb.png')'",
      "aurora.@toolbar_item[0]=toolbar_item",
      "aurora.@toolbar_item[0].icon='hub-tb-cccccccccccc.png'",
    ].join("\n"),
  );
  assert.deepEqual(left, [
    "hub-login-bg-bbbbbbbbbbbb.png",
    "hub-logo-aaaaaaaaaaaa.svg",
    "hub-tb-cccccccccccc.png",
  ]);
});

test("sweep_hub_images: 回滚还要用的不动", () => {
  const left = runSweep(
    ["hub-logo-aaaaaaaaaaaa.svg", "hub-tb-bbbbbbbbbbbb.png"],
    "aurora.theme.nav_type='sidebar'",
    ["hub-logo-aaaaaaaaaaaa.svg", "hub-tb-bbbbbbbbbbbb.png.new"],
  );
  // 一张是备份下来的原图，一张记着"本次新引入"——两张都是 restore 的输入。
  assert.deepEqual(left, ["hub-logo-aaaaaaaaaaaa.svg", "hub-tb-bbbbbbbbbbbb.png"]);
});

test("sweep_hub_images: 用户自己上传的 hub-* 文件不算垃圾", () => {
  // upload_icon 不限制文件名，一个叫 hub-vacation.png 的自有图标完全合法。
  // 只按前缀清理，等于在用户没把它设成任何槽位时把它删掉——纯粹的数据丢失。
  const left = runSweep(
    [
      "hub-vacation.png",
      "hub-logo-notahexstring.svg",
      "hub-tb-aaaaaaaaaaaa.png", // 这个才是本函数产的形状
    ],
    "aurora.theme.nav_type='sidebar'",
  );
  assert.deepEqual(left, ["hub-logo-notahexstring.svg", "hub-vacation.png"]);
});

// ---------------------------------------------------------------------------
// 时序
// ---------------------------------------------------------------------------

test("hub_apply_worker: 清理排在所有资产落地之后", () => {
  const body = slice("hub_apply_worker");
  assert.ok(
    body.indexOf("apply_hub_asset") < body.indexOf("sweep_hub_images"),
    "抢在资产之前跑，就会把刚下载的图当成垃圾删掉",
  );
  assert.ok(
    body.indexOf("sweep_hub_images") < body.indexOf("record_active_source"),
  );
});

test("hub_restore_backup: 回滚之后也要清一次", () => {
  const branch = rpcd.match(/"hub_restore_backup"\)([\s\S]*?)\n\t;;/);
  assert.ok(branch);
  // restore_pre_hub_images 只认得**这一次**备份记下的东西；中间那些没拍快照的
  // apply（拿商店主题盖商店主题）留下的图，只有 sweep 按"还有没有槽位指着"
  // 才收得干净。
  assert.match(branch[1], /sweep_hub_images/);
  assert.ok(
    branch[1].indexOf("restore_pre_hub_images") < branch[1].indexOf("sweep_hub_images"),
  );
});

// ---------------------------------------------------------------------------
// apply_hub_toolbar_icon —— 落地之后要把用它的快捷方式全部指过来
// ---------------------------------------------------------------------------

function applyIcon(kind, uciOut) {
  const script =
    constant("MAX_SHARED_TOOLBAR_ICONS") +
    `ICON_PATH="/nonexistent"\nDEVICE_DIR="/nonexistent"\n` +
    UCI_STUB +
    // apply_hub_asset 自己有单独的测试;这里替身掉,好让这一条只测"指过来"。
    `apply_hub_asset() { APPLIED_ASSET_NAME="hub-tb-aaaaaaaaaaaa.png"; return 0; }\n` +
    slice("has_control_char") +
    slice("strip_control_chars") +
    slice("is_theme_shipped_image") +
    slice("toolbar_icon_custom") +
    slice("toolbar_item_shareable") +
    slice("nth_custom_toolbar_icon") +
    slice("apply_hub_toolbar_icon") +
    `\nif apply_hub_toolbar_icon "${kind}" deadbeef http://x/; then echo RC_OK; else echo RC_FAIL; fi\n`;
  const log = execFileSync("sh", ["-c", script], {
    encoding: "utf8",
    env: { ...process.env, UCI_OUT: uciOut, UCI_LOG: "/dev/stdout" },
  });
  return log.trim().split("\n").filter(Boolean);
}

const twoUsers = toolbarFixture([
  ok({ icon: "alpha.png" }),
  ok({ icon: "beta.png" }),
  ok({ icon: "alpha.png" }),
]);

test("apply_hub_toolbar_icon: 每一条用了这个图标的快捷方式都被指过来", () => {
  // toolbar_icon_0 = 第一个不同的图标 = alpha.png,被第 0 和第 2 条用着。
  const log = applyIcon("toolbar_icon_0", twoUsers);
  // 断言里带上 =值:指过来还不够,得指到**刚落地的那个名字**上。
  assert.deepEqual(log, [
    "SET aurora.@toolbar_item[0].icon=hub-tb-aaaaaaaaaaaa.png",
    "SET aurora.@toolbar_item[2].icon=hub-tb-aaaaaaaaaaaa.png",
    "COMMIT",
    "RC_OK",
  ]);
});

test("apply_hub_toolbar_icon: 编号对应的是第 k 个不同的图标,不是第 k 条快捷方式", () => {
  // 第 1 条快捷方式用 beta.png,而 beta.png 是第 1 个(0-based)不同的图标 ——
  // 这两个数字在这份夹具里恰好都是 1,所以再换一份让它们分开:
  const log = applyIcon(
    "toolbar_icon_1",
    toolbarFixture([
      ok({ icon: "alpha.png" }),
      ok({ icon: "alpha.png" }),
      ok({ icon: "alpha.png" }),
      ok({ icon: "beta.png" }),
    ]),
  );
  assert.deepEqual(log, [
    "SET aurora.@toolbar_item[3].icon=hub-tb-aaaaaaaaaaaa.png",
    "COMMIT",
    "RC_OK",
  ]);
});

test("apply_hub_toolbar_icon: 没有对应槽位的资产不落地", () => {
  // hub 送来一个 toolbar_icon_5,而这份配置只有两个不同的图标。多出来的那份
  // 字节没有归属,写下去只会在 ICON_PATH 里躺着。
  const log = applyIcon("toolbar_icon_5", twoUsers);
  assert.deepEqual(log, ["RC_FAIL"]);
});

test("apply_hub_toolbar_icon: kind 里的编号不是数字就直接拒", () => {
  assert.deepEqual(applyIcon("toolbar_icon_", twoUsers), ["RC_FAIL"]);
  assert.deepEqual(applyIcon("toolbar_icon_x", twoUsers), ["RC_FAIL"]);
});

// ---------------------------------------------------------------------------
// strip_control_chars —— busybox 的 tr 不认字符类
// ---------------------------------------------------------------------------

// 真机（JDCloud RE-CS-02, busybox）上 `tr -d '[:cntrl:]'` 把参数当成字面集合
// { [ : c n t r l }，于是每个分享出去的快捷方式标题都悄悄少掉它的 c/n/t/r/l：
// "Overview" → "Oveview"、"Again" → "Agai"，而接收端把这个残缺版写进 uci。
// GNU tr 和 BSD tr 都实现了字符类，所以开发机上永远看不到。
test("strip_control_chars: 只删控制字符，字面的 c/n/t/r/l 一个都不能少", () => {
  const script =
    slice("strip_control_chars") +
    `\nfor s in "$@"; do printf '[%s]\\n' "$(strip_control_chars "$s")"; done\n`;
  const out = runSh(
    `set -- "Overview" "Again" "Control Center" "[:cntrl:]" ""\n${script}`,
  );
  assert.deepEqual(out.trim().split("\n"), [
    "[Overview]",
    "[Again]",
    "[Control Center]",
    "[[:cntrl:]]",
    "[]",
  ]);
});

test("strip_control_chars: 控制字符确实被删掉", () => {
  const script =
    slice("strip_control_chars") +
    `\nv=$(printf 'a\\tb\\001c\\rd')
     r=$(strip_control_chars "$v"); printf '%s/%s\\n' "$r" "\${#r}"
     r=$(strip_control_chars "$(printf '\\001\\002')"); printf '%s/%s\\n' "$r" "\${#r}"
     r=$(strip_control_chars "$(printf '\\001lead')"); printf '%s/%s\\n' "$r" "\${#r}"\n`;
  assert.deepEqual(runSh(script).trim().split("\n"), ["abcd/4", "/0", "lead/4"]);
});

test("rpcd script: 三处标题剥离都走这个函数，没有 tr 的残留", () => {
  // 注释里点到 `tr -d '[:cntrl:]'` 是在解释为什么不用它;代码里一处都不能剩。
  const code = rpcd
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
  assert.ok(
    !code.includes("tr -d '[:cntrl:]'"),
    "busybox 的 tr 会把标题里的 c/n/t/r/l 删掉",
  );
  assert.equal(
    (code.match(/strip_control_chars /g) || []).length,
    // 分享端逐项校验、分享端取标题、应用端 —— 三处
    3,
    "三处标题剥离都必须走同一个函数",
  );
});

// 剥离是按控制字符个数循环的,而应用端的 title 直接来自 hub 响应。
test("rpcd script: 应用端在剥离之前先粗筛长度", () => {
  const body = slice("validate_and_apply_hub_payload");
  const capIdx = body.indexOf('[ "${#title}" -le 200 ]');
  const stripIdx = body.indexOf('strip_control_chars "$title"');
  assert.ok(capIdx >= 0, "缺少长度粗筛");
  assert.ok(capIdx < stripIdx, "粗筛必须排在剥离之前,否则是一条拒绝服务路径");
});
