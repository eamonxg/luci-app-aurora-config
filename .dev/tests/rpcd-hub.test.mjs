import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const rpcd = readFileSync(
  path.join(repoRoot, "root/usr/libexec/rpcd/luci.aurora"),
  "utf8",
);
const acl = readFileSync(
  path.join(repoRoot, "root/usr/share/rpcd/acl.d/luci-app-aurora.json"),
  "utf8",
);

test("rpcd script: hub constants are defined", () => {
  assert.match(rpcd, /readonly HUB_BASE="https:\/\/themes\.eamonxg\.fun"/);
  assert.match(rpcd, /readonly DEVICE_DIR="\/etc\/aurora"/);
  assert.match(rpcd, /readonly HUB_JOB_PATH="\/tmp\/aurora_hub_jobs"/);
});

test("rpcd script: device identity and hub HTTP helpers are defined", () => {
  assert.match(rpcd, /ensure_device_identity\(\)\s*\{/);
  assert.match(rpcd, /hub_http_get\(\)\s*\{/);
  assert.match(rpcd, /hub_http_post\(\)\s*\{/);
});

test("rpcd script: ensure_device_identity generates and locks down device files", () => {
  assert.match(rpcd, /DEVICE_DIR\/device\.key/);
  assert.match(rpcd, /chmod 600 "\$DEVICE_DIR\/device\.key"/);
  assert.match(rpcd, /DEVICE_DIR\/device\.hash/);
  assert.match(rpcd, /chmod 644 "\$DEVICE_DIR\/device\.hash"/);
  assert.match(
    rpcd,
    /head -c32 \/dev\/urandom \| hexdump -v -e '\/1 "%02x"'/,
  );
  assert.match(rpcd, /DEVICE_TOKEN=\$\(cat "\$DEVICE_DIR\/device\.key"\)/);
  assert.match(rpcd, /DEVICE_HASH=\$\(cat "\$DEVICE_DIR\/device\.hash"\)/);
});

test("rpcd script: hub_http_get reuses fetch_url", () => {
  assert.match(rpcd, /fetch_url "\$out" "\$HUB_BASE\$1"/);
});

test("rpcd script: hub_http_post posts JSON via wget", () => {
  assert.match(rpcd, /--post-file="\$2" "\$HUB_BASE\$1"/);
  assert.match(rpcd, /Content-Type: application\/json/);
});

// uclient-fetch (what /usr/bin/wget actually is on OpenWrt) treats
// --post-file as "use the POST method with this body", so combining it with
// --method is a contradiction: it prints its usage and exits non-zero, which
// the caller can only surface as hub_unreachable. Update and delete were dead
// on arrival because of this. The flag that pairs with --method is
// --body-file.
test("rpcd script: PUT and DELETE pair --method with --body-file, never --post-file", () => {
  assert.match(rpcd, /--method=PUT --body-file="\$2"/);
  assert.match(rpcd, /--method=DELETE --body-file="\$2"/);
  assert.ok(
    !/--method=\w+ --post-file/.test(rpcd),
    "--post-file forces POST; pairing it with --method makes uclient-fetch reject the call",
  );
});

// --- Task 5: apply job (backup + local validation + assets + rollback) ---

test("rpcd script: job status writer and validator functions are defined", () => {
  assert.match(rpcd, /write_hub_job_status\(\)\s*\{/);
  assert.match(rpcd, /validate_and_apply_hub_payload\(\)\s*\{/);
  assert.match(rpcd, /hub_apply_worker\(\)\s*\{/);
});

test("rpcd script: write_hub_job_status prunes status files older than an hour (/tmp/aurora_hub_jobs is never otherwise cleaned up)", () => {
  const body = extractFunctionBody(rpcd, "write_hub_job_status");
  assert.match(body, /find\s+"\$HUB_JOB_PATH"\s+-name\s+'\*\.status'\s+-mmin\s+\+60\s+-delete/);
});

test("rpcd script: hub_apply, get_hub_status, hub_restore_backup handlers exist", () => {
  assert.ok(rpcd.includes('"hub_apply")'));
  assert.ok(rpcd.includes('"get_hub_status")'));
  assert.ok(rpcd.includes('"hub_restore_backup")'));
});

test("rpcd script: hub_apply, get_hub_status, hub_restore_backup registered in list branch", () => {
  assert.ok(rpcd.includes('json_add_object "hub_apply"'));
  assert.ok(rpcd.includes('json_add_object "get_hub_status"'));
  assert.ok(rpcd.includes('json_add_object "hub_restore_backup"'));
});

test("rpcd script: get_hub_status guards job_id with the font-job charset pattern", () => {
  assert.match(rpcd, /""\|\*\[!A-Za-z0-9_\.\-\]\*\)/);
});

test("rpcd script: worker takes a pre-hub-backup snapshot before touching UCI", () => {
  assert.match(rpcd, /pre-hub-backup\.conf/);
  assert.match(rpcd, /cp\s+"?\$CONFIG_FILE"?\s+"\$DEVICE_DIR\/pre-hub-backup\.conf"/);
});

test("rpcd script: hub_restore_backup restores the snapshot and resyncs derived state", () => {
  assert.match(
    rpcd,
    /cp\s+"\$DEVICE_DIR\/pre-hub-backup\.conf"\s+"?\$CONFIG_FILE"?/,
  );
  assert.match(rpcd, /"no_backup"/);
});

test("rpcd script: color validation uses the variable-length hex regex", () => {
  assert.match(rpcd, /\[0-9a-f\]\{3,4\}/);
});

test("rpcd script: colors are applied with single-quoted uci batch values", () => {
  assert.match(rpcd, /set aurora\.theme\.%s='%s'/);
});

test("rpcd script: uci commit failure reverts the batch and reports error", () => {
  assert.match(rpcd, /uci -q revert aurora/);
});

test("rpcd script: hub-applied bookkeeping is written on success", () => {
  assert.match(rpcd, /aurora\.theme\.hub_applied/);
  assert.match(rpcd, /aurora\.theme\.icon_cache_version/);
});

test("rpcd script: assets are fetched with checksum verification and skip on failure", () => {
  assert.match(rpcd, /fetch_verified\s+"\$tmp_path"/);
  const workerBody = extractFunctionBody(rpcd, "hub_apply_worker");
  assert.match(workerBody, /apply_hub_asset\s+"\$a_kind"\s+"\$a_sha256"/);
});

test("rpcd script: login_bg asset lands as struct_login_bg", () => {
  assert.match(rpcd, /struct_login_bg/);
});

// --- FINAL-REVIEW: fetch_verified used to be pointed straight at the live
// shipped-default image file, so a corrupt/mismatched hub download deleted
// the factory default with nothing to fall back to; and hub_restore_backup
// restored /etc/config/aurora but never the images an apply had overwritten.
// apply_hub_asset now fetches+verifies to a temp path and only mv's onto the
// live target on success, backing it up first. ---

test("rpcd script: apply_hub_asset fetches+verifies to a temp path, never rm's the live target on failure, and mv's only on success", () => {
  const body = extractFunctionBody(rpcd, "apply_hub_asset");
  assert.match(body, /tmp_path="\$ICON_PATH\/\.hubtmp-\$\$"/);
  assert.match(body, /fetch_verified\s+"\$tmp_path"\s+"\$sha256"\s+"\$url"/);
  assert.match(body, /mv\s+"\$tmp_path"\s+"\$target_path"/);
  assert.ok(!/rm -f "\$target_path"/.test(body), "must never rm the live target file");
});

// 名字现在是 sha 派生的,所以落地通常是**新增**而不是覆盖。两件事因此都要做:
// 覆盖到的备份下来,新增的打 .new 标记 —— 少了后者,回滚会把别人的图永远留在
// overlay 上(字体那边同样的道理,见 restore_pre_hub_fonts)。
test("rpcd script: apply_hub_asset records what a rollback has to undo", () => {
  const body = extractFunctionBody(rpcd, "apply_hub_asset");
  assert.match(body, /backup_dir="\$DEVICE_DIR\/pre-hub-images"/);
  assert.match(body, /cp -p "\$target_path" "\$backup_dir\/\$name"/);
  assert.match(body, /: > "\$backup_dir\/\$name\.new"/);
});

test("rpcd script: apply_hub_asset points the matching uci option at the applied filename on success", () => {
  const body = extractFunctionBody(rpcd, "apply_hub_asset");
  assert.match(rpcd, /hub_asset_uci_option\(\)\s*\{/);
  assert.match(body, /uci -q set "aurora\.theme\.\$opt=\$name"/);
  assert.match(body, /struct_login_bg="url\('\/luci-static\/aurora\/images\/\$name'\)"/);
});

// 单槽位快照现在住在 backup_if_mine 里,worker 只是调用它 —— 因为清空上一次的
// 图片备份和拍这次的配置快照必须同进同退:只做一半,回滚就会交还一份配置配着
// 另一套图片。
test("rpcd script: the single-slot snapshot clears any prior apply's image backups before taking a new one", () => {
  const workerBody = extractFunctionBody(rpcd, "hub_apply_worker");
  assert.match(workerBody, /backup_if_mine/);
  const backupBody = extractFunctionBody(rpcd, "backup_if_mine");
  assert.match(backupBody, /rm -rf "\$DEVICE_DIR\/pre-hub-images"/);
});

test("rpcd script: hub_restore_backup restores backed-up images alongside /etc/config/aurora", () => {
  const branchMatch = rpcd.match(/"hub_restore_backup"\)([\s\S]*?)\n\t;;/);
  assert.ok(branchMatch);
  assert.match(branchMatch[1], /restore_pre_hub_images/);
  const restoreBody = extractFunctionBody(rpcd, "restore_pre_hub_images");
  assert.match(restoreBody, /pre-hub-images/);
  assert.match(restoreBody, /cp -p "\$f" "\$ICON_PATH\/\$\{f##\*\/\}"/);
  assert.match(restoreBody, /rm -rf "\$backup_dir"/);
  // 先删本次新引入的,再拷回被覆盖的 —— 顺序是正确性的一部分:一张图可以两者
  // 都是(这次覆盖掉的,正是更早一次 apply 引入的)。
  const dropIdx = restoreBody.indexOf('rm -f "$ICON_PATH/${base%.new}"');
  const copyIdx = restoreBody.indexOf('cp -p "$f" "$ICON_PATH/${f##*/}"');
  assert.ok(dropIdx >= 0, "must drop the files this apply introduced");
  assert.ok(dropIdx < copyIdx, "dropping must come before copying back");
});

test("rpcd script: worker posts a download count after a successful apply", () => {
  assert.match(rpcd, /\/api\/v1\/themes\/aurora\/configs\/.*\/download/);
  assert.match(rpcd, /device_hash/);
  assert.match(rpcd, /hub_http_post/);
});

test("rpcd script: bad payload is rejected before any uci write (validator returns non-zero)", () => {
  assert.match(rpcd, /bad_payload/);
});

// --- FINAL-REVIEW: hub_http_get returns the hub config body FLAT (no "data"
// wrapper -- that envelope is the frontend's, added by hubFetch in
// utils/hub-api.js). hub_apply_worker and hub_my_shares call hub_http_get
// directly, so a `json_select data` there always fails, meaning every
// hub_apply used to report bad_payload unconditionally. ---

test("rpcd script: hub_apply_worker never selects a 'data' wrapper off the raw hub_http_get body", () => {
  const workerBody = extractFunctionBody(rpcd, "hub_apply_worker");
  assert.ok(!/json_select\s+data/.test(workerBody), "hub_http_get's own response has no 'data' wrapper to select");
  // validate_and_apply_hub_payload now takes the whole flat body directly,
  // and does its own json_load/json_select internally instead of the
  // caller pre-extracting + re-json_dump'ing a "payload" subtree (json_dump
  // always dumps from the jshn root, ignoring any prior json_select, so the
  // old payload_json=$(json_dump)-after-select was silently dumping the
  // wrong subtree).
  assert.match(workerBody, /validate_and_apply_hub_payload\s+"\$body"/);
});

test("rpcd script: validate_and_apply_hub_payload reads the flat body directly (json_load + json_select payload internally, no re-dump-after-select)", () => {
  const validateBody = extractFunctionBody(rpcd, "validate_and_apply_hub_payload");
  assert.match(validateBody, /json_load\s+"\$body_json"/);
  assert.match(validateBody, /json_get_var\s+hub_name\s+"name"/);
  assert.match(validateBody, /json_select\s+payload\s+2>\/dev\/null/);
  assert.ok(!/json_dump/.test(validateBody), "must navigate the loaded tree in place, never re-dump a subtree");
});

test("rpcd script: hub_apply_worker selects assets at the flat body's root (not under data or payload)", () => {
  const workerBody = extractFunctionBody(rpcd, "hub_apply_worker");
  assert.match(workerBody, /json_load\s+"\$body"\s+2>\/dev\/null\s*\n\s*if json_select assets 2>\/dev\/null; then/);
});

// A shared configuration names a font preset this router has very likely never
// downloaded. sync_font_css_from_uci only rewrites the CSS from whatever woff2
// files are already cached, and every font stack ends in a built-in family, so
// the missing webfont never fails loudly -- it silently renders as Lato and the
// applied theme looks like only its colours arrived. Every path that swaps the
// whole config for one from elsewhere has to fetch the files too.
test("rpcd script: config-replacing paths cache the fonts they name, not just rewrite the CSS", () => {
  const workerBody = extractFunctionBody(rpcd, "hub_apply_worker");
  assert.match(workerBody, /^\s*sync_and_cache_fonts_from_uci\s*$/m);
  assert.ok(
    !/^\s*sync_font_css_from_uci\s*$/m.test(workerBody),
    "hub_apply_worker must not stop at the cache-only resync",
  );

  // import_config and hub_restore_backup replace the config the same way:
  // an imported file comes from another device, and a rollback target's font
  // cache may already have been cleaned up by the apply it is undoing.
  ["import_config", "hub_restore_backup"].forEach((handler) => {
    const start = rpcd.indexOf(`"${handler}")`);
    assert.ok(start >= 0, `${handler} handler should exist`);
    const branch = rpcd.slice(start, start + 1200);
    assert.match(
      branch,
      /sync_and_cache_fonts_from_uci/,
      `${handler} must fetch the fonts its new config names`,
    );
  });
});

test("acl: hub_apply and hub_restore_backup granted under write.ubus, get_hub_status under read.ubus", () => {
  const acljson = JSON.parse(acl);
  const writeMethods = acljson["luci-app-aurora"].write.ubus["luci.aurora"];
  const readMethods = acljson["luci-app-aurora"].read.ubus["luci.aurora"];
  assert.ok(writeMethods.includes("hub_apply"));
  assert.ok(writeMethods.includes("hub_restore_backup"));
  assert.ok(readMethods.includes("get_hub_status"));
});

test("acl: hub job paths are granted", () => {
  const acljson = JSON.parse(acl);
  const writeFiles = acljson["luci-app-aurora"].write.file;
  const readFiles = acljson["luci-app-aurora"].read.file;
  assert.ok(Object.keys(writeFiles).some((p) => p.startsWith("/tmp/aurora_hub_jobs")));
  assert.ok(Object.keys(readFiles).some((p) => p.startsWith("/tmp/aurora_hub_jobs")));
});

// --- FINAL-REVIEW fix wave ---

test("acl: /etc/aurora is NOT file-ACL granted (rpcd handlers run as root and never need it; granting it would let browser JS read device.key via fs.read)", () => {
  const acljson = JSON.parse(acl);
  const writeFiles = Object.keys(acljson["luci-app-aurora"].write.file);
  const readFiles = Object.keys(acljson["luci-app-aurora"].read.file);
  assert.ok(!writeFiles.some((p) => p.startsWith("/etc/aurora")), "write.file must not grant /etc/aurora/*");
  assert.ok(!readFiles.some((p) => p.startsWith("/etc/aurora")), "read.file must not grant /etc/aurora/*");
});

test("acl: the fixed /tmp/aurora_hub_share.json path is gone (share/update now use mktemp)", () => {
  const acljson = JSON.parse(acl);
  const writeFiles = Object.keys(acljson["luci-app-aurora"].write.file);
  assert.ok(!writeFiles.includes("/tmp/aurora_hub_share.json"));
  assert.ok(!rpcd.includes("/tmp/aurora_hub_share.json"), "script must no longer reference the fixed share-body path");
});

test("rpcd script: the publish calls write their request body via mktemp, not a fixed path", () => {
  const beginMatch = rpcd.match(/"hub_share_begin"\)([\s\S]*?)\n\t\t;;/);
  const commitMatch = rpcd.match(/"hub_share_commit"\)([\s\S]*?)\n\t\t;;/);
  assert.ok(beginMatch && commitMatch);
  assert.match(beginMatch[1], /draft_body_tmp=\$\(mktemp\)/);
  assert.match(commitMatch[1], /commit_body_tmp=\$\(mktemp\)/);
});

test("sysupgrade: device identity files are preserved across firmware upgrades", () => {
  const sysupgradeFile = readFileSync(
    path.join(repoRoot, "root/etc/sysupgrade.conf.d/aurora-device"),
    "utf8",
  );
  const lines = sysupgradeFile.trim().split("\n").map((l) => l.trim());
  assert.ok(lines.includes("/etc/aurora/device.key"));
  assert.ok(lines.includes("/etc/aurora/device.hash"));
});

// --- Security review round 1: embedded-newline bypass + unchecked uci batch ---

test("rpcd script: has_control_char helper rejects embedded control characters (incl. newline)", () => {
  assert.match(rpcd, /has_control_char\(\)\s*\{/);
  assert.match(rpcd, /\*\[\[:cntrl:\]\]\*/);
});

test("rpcd script: every free-text field is guarded by has_control_char before its regex/case check", () => {
  // colors, the three rem fields, struct_font_sans/mono, toolbar url/icon,
  // and the server-supplied hub name must all be rejected outright on any
  // control character (never silently stripped) before the format regex
  // runs -- grep/case anchors are line-based, not whole-string, so a value
  // with an embedded newline can smuggle a second uci-batch command past a
  // regex/case check alone.
  const guardCount = (rpcd.match(/has_control_char\s+"\$\w+"\s*&&/g) || []).length;
  assert.ok(
    guardCount >= 8,
    `expected at least 8 has_control_char guard call sites, found ${guardCount}`,
  );
  // hub_name is guarded by has_batch_unsafe_char (control chars OR a literal
  // quote -- see the round-4 test below), a strict superset of has_control_char.
  assert.match(rpcd, /has_batch_unsafe_char\s+"\$hub_name"\s*&&/);
});

test("rpcd script: uci batch exit status is checked (not just the later uci commit)", () => {
  assert.match(rpcd, /if\s+!\s*\{[\s\S]*?\}\s*\|\s*uci batch;\s*then/);
});

// --- Security review round 4: uci batch always exits 0, and a literal
// single quote (legal per the hub's own struct_font_*/title regexes) breaks
// the single-quoted `set foo='value'` batch line, silently dropping that
// field instead of failing the apply. ---

test("rpcd script: has_batch_unsafe_char rejects control chars and a literal single quote", () => {
  assert.match(rpcd, /has_batch_unsafe_char\(\)\s*\{/);
  assert.match(rpcd, /has_batch_unsafe_char\(\)\s*\{\s*\n\s*has_control_char "\$1" && return 0\s*\n\s*case "\$1" in \*\\'\*\) return 0 ;; esac/);
});

test("rpcd script: hub_applied name, struct_font_sans/mono, and toolbar title all reject a literal single quote before entering the uci batch", () => {
  assert.match(rpcd, /has_batch_unsafe_char\s+"\$hub_name"\s*&&/);
  const validateBody = extractFunctionBody(rpcd, "validate_and_apply_hub_payload");
  assert.match(validateBody, /case "\$struct_font_sans" in \*\\'\*\) rm -f "\$batch_file"; return 1 ;; esac/);
  assert.match(validateBody, /case "\$struct_font_mono" in \*\\'\*\) rm -f "\$batch_file"; return 1 ;; esac/);
  assert.match(validateBody, /case "\$trimmed_title" in\s*\n\s*\*\\'\*\) json_select \.\.; rm -f "\$batch_file"; return 1 ;;/);
});

test("rpcd script: build_share_payload and is_valid_font_stack also reject a literal single quote, for consistency with the apply side", () => {
  assert.match(rpcd, /is_valid_font_stack\(\)\s*\{[\s\S]*?case "\$v" in \*\\'\*\) return 1 ;; esac/);
  const itemBody = extractFunctionBody(rpcd, "toolbar_item_shareable");
  assert.match(itemBody, /case "\$trimmed_title" in \*\\'\*\) return 1 ;; esac/);
});

test("rpcd script: require_color_token_keys guards colors validation", () => {
  assert.match(rpcd, /require_color_token_keys\s*\|\|\s*return 1/);
});

// --- Security review round 2: the asset sha256 field had the same bypass ---

test("rpcd script: asset sha256 is guarded against control characters before its hex64 check", () => {
  // The sha256 field feeds hub_asset_target_name's login_bg filename, so it
  // needs the same has_control_char guard as every other free-text field --
  // `grep '^[0-9a-fA-F]{64}$'` alone is line-anchored, not whole-string
  // anchored, so "64 hex chars\nrm -rf /" would otherwise still satisfy it
  // on the first line.
  assert.match(
    rpcd,
    /!\s*has_control_char\s+"\$a_sha256"[\s\S]{0,80}grep -Eq '\^\[0-9a-fA-F\]\{64\}\$'/,
  );
});

// --- Task 7: share backend (build payload + share/my_shares/update/delete) ---

test("rpcd script: hub_http_put and hub_http_delete mirror hub_http_post", () => {
  assert.match(rpcd, /hub_http_put\(\)\s*\{/);
  assert.match(rpcd, /hub_http_delete\(\)\s*\{/);
  assert.match(rpcd, /--method=PUT/);
  assert.match(rpcd, /--method=DELETE/);
});

test("rpcd script: resolve_font_preset_id reverse-maps struct_font_<slot> via font-presets.conf", () => {
  assert.match(rpcd, /resolve_font_preset_id\(\)\s*\{/);
  assert.match(
    rpcd,
    /awk -F'\|' -v s="\$slot" -v k="\$stack" '\$1=="font"&&\$2==s&&\$7==k\s*\{\s*print \$3;\s*exit\s*\}'/,
  );
  assert.match(rpcd, /echo "default"|printf '%s' "default"/);
});

test("rpcd script: build_share_payload is defined and writes schema/theme", () => {
  assert.match(rpcd, /build_share_payload\(\)\s*\{/);
  assert.match(rpcd, /json_add_int "schema" 1/);
  assert.match(rpcd, /json_add_string "theme" "aurora"/);
});

test("rpcd script: build_share_payload assembles colors/layout/typography from uci", () => {
  assert.match(rpcd, /json_add_object "colors"/);
  assert.match(rpcd, /json_add_object "layout"/);
  assert.match(rpcd, /json_add_object "typography"/);
  assert.match(rpcd, /resolve_font_preset_id sans/);
  assert.match(rpcd, /resolve_font_preset_id mono/);
});

test("rpcd script: build_share_payload assembles the toolbar from anonymous toolbar_item sections", () => {
  assert.ok(
    rpcd.includes(
      String.raw`uci show aurora 2>/dev/null | sed -n 's/^aurora\.\([^.=]*\)=toolbar_item$/\1/p'`,
    ),
  );
});

test("rpcd script: toolbar url filtering rejects protocol-relative urls but allows http(s)/relative", () => {
  const itemBody = extractFunctionBody(rpcd, "toolbar_item_shareable");
  assert.match(itemBody, /\/\/\*\)\s*return 1/);
  assert.match(itemBody, /http:\/\/\*\|https:\/\/\*\|\/\*\)/);
});

test("rpcd script: build_share_payload skips filenames the theme itself ships", () => {
  const body = extractFunctionBody(rpcd, "is_theme_shipped_image");
  assert.match(body, /logo\.svg\|favicon\.ico\|app-icon-192x192\.png\|app-icon-512x512\.png\|apple-touch-icon\.png/);
  // 默认工具栏那四个也算主题自带:接收方的机器上本来就有,发过去只是浪费,
  // 还会让对方用作者那份副本而不是自己已经装好的那份。
  assert.match(body, /network\.svg\|overview\.svg\|software\.svg\|system\.svg/);
  assert.match(extractFunctionBody(rpcd, "local_image_name"), /is_theme_shipped_image "\$fname" && return 1/);
});

// sha256/size 仍然由路由器算 —— 这是浏览器直传能安全的关键:hub 校验浏览器
// 送上来的字节 hash 等于路由器声明的 hash,所以一个被篡改的页面换不掉这张图。
// base64 那一步没了(见 "emits a filename sidecar" 一测)。
test("rpcd script: build_share_payload computes sha256/size, busybox-safe", () => {
  assert.match(rpcd, /sha256sum "\$file" 2>\/dev\/null \| cut -d' ' -f1/);
  assert.match(rpcd, /wc -c < "\$file"/);
});

// hub_share/hub_update 是单请求的老路:它们把整张登录背景 base64 塞进一个
// 1.6MB 的 body,而 uclient-fetch 走 TLS 推不动 —— 任何设了登录背景的人都
// 发布不出去。三段式取代了它们,这里钉住"不许回来"。
test("rpcd script: hub_share_begin, hub_share_commit, hub_me, hub_delete handlers exist", () => {
  assert.ok(rpcd.includes('"hub_share_begin")'));
  assert.ok(rpcd.includes('"hub_share_commit")'));
  assert.ok(rpcd.includes('"hub_me")'));
  assert.ok(rpcd.includes('"hub_delete")'));
  assert.ok(!rpcd.includes('"hub_share")'), "the single-request publish is gone");
  assert.ok(!rpcd.includes('"hub_update")'), "the single-request update is gone");
});

test("rpcd script: the hub methods are registered in the list branch", () => {
  assert.ok(rpcd.includes('json_add_object "hub_share_begin"'));
  assert.ok(rpcd.includes('json_add_object "hub_share_commit"'));
  assert.ok(rpcd.includes('json_add_object "hub_me"'));
  assert.ok(rpcd.includes('json_add_object "hub_delete"'));
});

test("rpcd script: hub_share_begin validates name/description with has_control_char before use", () => {
  const shareBranchMatch = rpcd.match(/"hub_share_begin"\)([\s\S]*?)\n\t;;/);
  assert.ok(shareBranchMatch, "hub_share_begin branch should exist");
  const body = shareBranchMatch[1];
  assert.match(body, /has_control_char\s+"\$name"/);
  assert.match(body, /has_control_char\s+"\$description"/);
  // The signature is not a publish field any more; hub_set_nickname owns it.
  assert.ok(!/\$author/.test(body), "publishing must not handle an author");
});

test("rpcd script: hub_share_begin ensures device identity, builds payload, and opens a draft", () => {
  const shareBranchMatch = rpcd.match(/"hub_share_begin"\)([\s\S]*?)\n\t;;/);
  assert.ok(shareBranchMatch);
  const body = shareBranchMatch[1];
  assert.match(body, /ensure_device_identity/);
  assert.match(body, /build_share_payload/);
  assert.match(body, /device_token/);
  assert.match(body, /hub_http_post\s+"\/api\/v1\/themes\/aurora\/configs\/draft"/);
  // Nothing is recorded locally: a published id is the hub's to remember, and
  // a local copy would survive a key import it no longer belongs to.
  assert.ok(!/hub_shares/.test(body), "publishing must not keep a local id list");
});

// The old hub_my_shares walked a local id file and issued one hub request per
// published config on every page load, with an elaborate rule that the file
// must never be rewritten there (a transient failure was indistinguishable
// from a 404, and dropping an id would have been unrecoverable). hub_me
// deletes that whole problem: the hub answers with the config list directly,
// so there is no local record to keep, lose, or wrongly prune.
test("rpcd script: hub_me asks the hub once and keeps no local list", () => {
  const branchMatch = rpcd.match(/"hub_me"\)([\s\S]*?)\n\t\t;;/);
  assert.ok(branchMatch, "hub_me branch should exist");
  const body = branchMatch[1];
  assert.match(body, /ensure_device_identity/);
  assert.match(body, /device_token/);
  assert.match(body, /hub_http_post\s+"\/api\/v1\/me"/);
  assert.ok(!/hub_shares/.test(body), "hub_me must not consult a local id list");
  assert.ok(
    !/while\s+IFS=/.test(body),
    "hub_me must be a single request, not a per-id loop",
  );
});

// 更新不再有自己的方法:它就是带 target_id 的发布。这条钉住 target_id 的
// 字符集守卫 —— 注意不能写成 ''|*[A-Za-z0-9]*),那个通配只要求"含有"一个
// 字母数字,"ab/../x" 也会过。
test("rpcd script: hub_share_begin guards target_id charset and forwards it", () => {
  const branchMatch = rpcd.match(/"hub_share_begin"\)([\s\S]*?)\n\t;;/);
  assert.ok(branchMatch);
  const body = branchMatch[1];
  assert.match(body, /\*\[!A-Za-z0-9\]\*\) echo '\{ "result": 1, "error": "invalid_id" \}'/);
  assert.match(body, /"target_id":"%s"/);
  assert.match(body, /build_share_payload/);
  assert.match(body, /device_token/);
});

test("rpcd script: hub_delete guards id charset and DELETEs with device_token", () => {
  const branchMatch = rpcd.match(/"hub_delete"\)([\s\S]*?)\n\t;;/);
  assert.ok(branchMatch);
  const body = branchMatch[1];
  assert.match(body, /case "\$id" in ''\|\*\[!A-Za-z0-9\]\*\)/);
  assert.match(body, /hub_http_delete\s+"\/api\/v1\/themes\/aurora\/configs\/\$id"/);
  assert.match(body, /device_token/);
  // No local list to prune any more -- hub_me re-reads the truth.
  assert.ok(!/hub_shares/.test(body), "hub_delete must not maintain a local id list");
});

test("acl: the publish calls are granted under write.ubus; hub_me under read.ubus", () => {
  const acljson = JSON.parse(acl);
  const writeMethods = acljson["luci-app-aurora"].write.ubus["luci.aurora"];
  const readMethods = acljson["luci-app-aurora"].read.ubus["luci.aurora"];
  assert.ok(writeMethods.includes("hub_share_begin"));
  assert.ok(writeMethods.includes("hub_share_commit"));
  assert.ok(writeMethods.includes("hub_delete"));
  assert.ok(readMethods.includes("hub_me"));
  // 老方法必须一并从 ACL 撤掉,否则一个被删掉的入口还挂在权限表上。
  assert.ok(!writeMethods.includes("hub_share"));
  assert.ok(!writeMethods.includes("hub_update"));
});

// Note: the fixed /tmp/aurora_hub_share.json path was removed (see the
// "acl: the fixed /tmp/aurora_hub_share.json path is gone" test above) --
// the publish calls write their request bodies via mktemp instead.

// --- Security review round 3: asset path traversal + un-enforced hub schema ---

function extractFunctionBody(source, name) {
  const marker = `${name}() {`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${name}() should be defined`);
  let depth = 0;
  let i = start + marker.length - 1; // index of the opening brace
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return source.slice(start, i + 1);
}

test("rpcd script: local_image_name rejects filenames containing '/' or '..' before ICON_PATH is joined", () => {
  const body = extractFunctionBody(rpcd, "local_image_name");
  // Guard must appear (and reject) before `$ICON_PATH/$fname` is ever built.
  const guardIdx = body.search(/case "\$fname" in \*\/\*\|\*\.\.\*\) return 1 ;; esac/);
  const fileIdx = body.indexOf('[ -f "$ICON_PATH/$fname" ]');
  assert.ok(guardIdx >= 0, "path-traversal guard on $fname should exist");
  assert.ok(fileIdx > guardIdx, "guard must run before ICON_PATH is joined");
  // build_share_payload must not have grown a second way to reach ICON_PATH.
  const shareBody = extractFunctionBody(rpcd, "build_share_payload");
  assert.match(shareBody, /fname=\$\(local_image_name "\$kind"\) \|\| continue/);
});

test("rpcd script: toolbar_item_shareable validates each item against the hub's field limits", () => {
  const body = extractFunctionBody(rpcd, "toolbar_item_shareable");
  // title: control-char-trimmed then 1-30. strip_control_chars, never
  // `tr -d '[:cntrl:]'` -- BusyBox's tr reads that as the literal set
  // { [ : c n t r l } and eats those letters out of the title.
  assert.match(body, /trimmed_title=\$\(strip_control_chars "\$title"\)/);
  assert.match(body, /tlen=\$\{#trimmed_title\}/);
  assert.match(body, /\[ "\$tlen" -ge 1 \] && \[ "\$tlen" -le 30 \] \|\| return 1/);
  // url: control-char guard, scheme guard, length cap
  assert.match(body, /has_control_char "\$url" && return 1/);
  assert.match(body, /\[ "\$\{#url\}" -le 200 \] \|\| return 1/);
  // icon: control-char guard, length cap, charset
  assert.match(body, /has_control_char "\$icon" && return 1/);
  assert.match(body, /\[ "\$\{#icon\}" -le 64 \] \|\| return 1/);
  assert.match(body, /grep -Eq '\^\[A-Za-z0-9\._-\]\+\$' \|\| return 1/);
  // enabled: enum guard
  assert.match(body, /case "\$enabled" in 0\|1\) ;; \*\) return 1 ;; esac/);
  // 两个消费者,一份规则。分开判就会让一条被打包跳过的快捷方式仍然占掉一个
  // 图标槽位号,接收端从那里往后全部错位。
  assert.match(extractFunctionBody(rpcd, "build_share_payload"), /toolbar_item_shareable "\$sid" \|\| continue/);
  assert.match(extractFunctionBody(rpcd, "nth_custom_toolbar_icon"), /toolbar_item_shareable "\$sid" \|\| continue/);
});

test("rpcd script: build_share_payload falls back to a canonical font stack when struct_font_* fails the hub's regex", () => {
  assert.match(rpcd, /is_valid_font_stack\(\)\s*\{/);
  assert.match(rpcd, /font_preset_stack\(\)\s*\{/);
  const body = extractFunctionBody(rpcd, "build_share_payload");
  assert.match(body, /is_valid_font_stack "\$struct_font_sans"/);
  assert.match(body, /font_preset_stack sans "\$font_sans_id"/);
  assert.match(body, /font_preset_stack sans default/);
  assert.match(body, /is_valid_font_stack "\$struct_font_mono"/);
  assert.match(body, /font_preset_stack mono "\$font_mono_id"/);
  assert.match(body, /font_preset_stack mono default/);
});

test("rpcd script: is_valid_font_stack enforces length, control-char, and charset rules", () => {
  assert.match(rpcd, /\[ "\$\{#v\}" -le 200 \] \|\| return 1/);
  assert.match(rpcd, /has_control_char "\$v" && return 1/);
});

test("rpcd script: hub_me replaces hub_my_shares", () => {
  assert.ok(rpcd.includes('json_add_object "hub_me"'), "hub_me not registered");
  assert.ok(!rpcd.includes("hub_my_shares"), "hub_my_shares must be gone");
  assert.match(rpcd, /hub_http_post "\/api\/v1\/me"/);
  // The local id list is no longer authoritative -- the hub is. Keeping a
  // read of it would reintroduce the failure this whole change removes: a
  // reflashed router showing an empty "my shares" for work it still owns.
  assert.ok(
    !rpcd.includes("$DEVICE_DIR/hub_shares"),
    "hub_shares must no longer be read or written",
  );
});

test("rpcd script: nickname is set through its own write method", () => {
  assert.ok(rpcd.includes('"hub_set_nickname")'), "hub_set_nickname handler missing");
  assert.match(rpcd, /json_add_string "nickname" "nickname"/);
  const branchMatch = rpcd.match(/"hub_set_nickname"\)([\s\S]*?)\n\t\t;;/);
  assert.ok(branchMatch, "hub_set_nickname branch should exist");
  const body = branchMatch[1];
  assert.match(body, /has_control_char\s+"\$nickname"/);
  assert.match(body, /hub_http_post\s+"\/api\/v1\/me"/);
  // The hub answers 200 even for "that name is taken" -- wget collapses every
  // 4xx into the same failure as an unreachable host -- so the body is passed
  // through for marketplace.js to turn into a sentence.
  assert.match(body, /"result": 0, "data": %s/);
});

test("rpcd script: publishing no longer carries an author", () => {
  assert.ok(!rpcd.includes('json_get_var author "author"'), "author still read from the call");
  assert.ok(!rpcd.includes("invalid_author"), "stale author validation");
  assert.ok(!/"author":"%s"/.test(rpcd), "author still sent to the hub");
});

test("rpcd script: key export/import exist and validate the shape", () => {
  assert.ok(rpcd.includes('"hub_export_key")'), "hub_export_key handler missing");
  assert.ok(rpcd.includes('"hub_import_key")'), "hub_import_key handler missing");
  // Same rule as the hub's TOKEN_PATTERN: exactly 64 lowercase hex.
  assert.match(rpcd, /\[ "\$\{#key\}" -eq 64 \]/);
  assert.match(rpcd, /\*\[!a-f0-9\]\*\)/);
  assert.match(rpcd, /chmod 600 "\$DEVICE_DIR\/device\.key\.tmp"/);
  // Both "the key now lives somewhere else" paths record the flag in rpcd:
  // marketplace.js is a browse-only view with no uci write path of its own.
  assert.ok(
    rpcd.split("hub_key_saved").length - 1 >= 2,
    "both export and import must record hub_key_saved",
  );
});

test("acl: exporting the key is a write capability, never a read one", () => {
  const parsed = JSON.parse(acl);
  const { read, write } = parsed["luci-app-aurora"];
  const readable = read.ubus["luci.aurora"];
  const writable = write.ubus["luci.aurora"];
  // Handing out device.key hands out account control -- publishing as this
  // creator, and deleting their work. Read access must not reach it.
  assert.ok(!readable.includes("hub_export_key"), "hub_export_key must not be readable");
  assert.ok(writable.includes("hub_export_key"), "hub_export_key missing from write");
  assert.ok(writable.includes("hub_import_key"), "hub_import_key missing from write");
});

test("acl: hub_me is readable and the stale hub_my_shares entry is gone", () => {
  const parsed = JSON.parse(acl);
  const read = parsed["luci-app-aurora"].read.ubus["luci.aurora"];
  assert.ok(read.includes("hub_me"), "hub_me missing from read");
  assert.ok(!read.includes("hub_my_shares"), "stale hub_my_shares in acl");
});

// --- A share the hub has already dropped is not an unreachable hub ---
//
// Measured on the device against the live hub: DELETE on an id the hub has
// already removed answers 404 -- uclient-fetch exits 8 and prints
// "HTTP error 404" on stderr; a host it cannot reach exits 4 and prints
// "Failed to send request". `-q` silences both lines, and the exit code alone
// lumps every error status together, so the helpers could only ever report
// hub_unreachable -- telling a user the store is down when their share is
// simply gone.

test("rpcd script: hub_http_gone reads the 404 off uclient-fetch's stderr", () => {
  const body = extractFunctionBody(rpcd, "hub_http_gone");
  assert.match(body, /HTTP error 404/, "the status line is the only 404 signal");
});

for (const fn of ["hub_http_put", "hub_http_delete"]) {
  test(`rpcd script: ${fn} tells a share the hub dropped apart from an unreachable hub`, () => {
    const body = extractFunctionBody(rpcd, fn);
    assert.ok(!/wget -qO/.test(body), "-q swallows the line that names the status");
    assert.match(body, /2>"\$err"/, "stderr must be kept, not discarded");
    assert.match(body, /hub_http_gone "\$err"/, "the status line must be consulted");
    assert.match(body, /rc=2/, "a dropped share needs a return code of its own");
  });
}

test("rpcd script: hub_delete answers invalid_id, not hub_unreachable, when the share is gone", () => {
  const branchMatch = rpcd.match(/"hub_delete"\)([\s\S]*?)\n\t;;/);
  assert.ok(branchMatch);
  const body = branchMatch[1];
  assert.match(
    body,
    /\n\t\t\t2\)[\s\S]{0,400}?"error": "invalid_id"/,
    "return code 2 must map to invalid_id",
  );
  assert.match(body, /\*\)[\s\S]{0,200}?"error": "hub_unreachable"/);
});

test("rpcd script: hub_share_commit answers invalid_id, not hub_unreachable, when the draft is gone", () => {
  // Sliced to the next branch, not by the `\n\t;;` the other tests use: that
  // one is lazy but the nearest single-tab `;;` is the end of the outer case,
  // so it swallows the following branch and would go green on its fix alone.
  const start = rpcd.indexOf('"hub_share_commit")');
  const end = rpcd.indexOf('"hub_me")', start);
  assert.ok(start > 0 && end > start, "hub_share_commit branch not found");
  const body = rpcd.slice(start, end);
  assert.match(
    body,
    /\n\t\t\t2\)[\s\S]{0,400}?"error": "invalid_id"/,
    "return code 2 must map to invalid_id",
  );
});

// --- The same 404 blindness on the read path ---
//
// hub_http_get goes through fetch_url, which is shared with asset downloads
// and is -q for their sake. So applying a theme the store had already taken
// down reported hub_unreachable too, and the store page told the user to check
// their connection over a theme that was simply gone.

test("rpcd script: fetch_url stays quiet unless the caller asks to keep stderr", () => {
  const body = extractFunctionBody(rpcd, "fetch_url");
  assert.match(body, /FETCH_URL_ERR/, "callers need a way to opt into stderr");
  // The other caller is the asset download loop; it must not start spraying
  // uclient-fetch progress meters into rpcd's stderr.
  assert.match(body, /\/dev\/null/, "discarding stderr stays the default");
  assert.match(body, /-q/, "quiet stays the default");
});

test("rpcd script: hub_http_get tells a theme the store dropped apart from an unreachable hub", () => {
  const body = extractFunctionBody(rpcd, "hub_http_get");
  assert.match(body, /FETCH_URL_ERR/, "stderr must be kept for this one call");
  assert.match(body, /hub_http_gone "\$err"/, "the status line must be consulted");
  assert.match(body, /rc=2/, "a dropped theme needs a return code of its own");
});

test("rpcd script: the apply worker reports invalid_id when the store no longer has the theme", () => {
  const body = extractFunctionBody(rpcd, "hub_apply_worker");
  assert.match(
    body,
    /"error" "fetch" "invalid_id"/,
    "a 404 on fetch must not be reported as hub_unreachable",
  );
  assert.match(body, /"error" "fetch" "hub_unreachable"/, "the network case must survive");
});

// §8.2 drifted silently: it still listed hub_list, hub_get and hub_my_shares
// long after they were deleted, and carried an `author` param that hub_share
// and hub_update never took. Nothing checked it, so nothing stopped it. This
// pins the table to the acl -- the one file that decides what is callable.
test("docs: the marketplace method table stays in step with the acl", () => {
  const docs = readFileSync(path.join(repoRoot, "docs/DEVELOPMENT.md"), "utf8");
  const section = docs.slice(docs.indexOf("### 8.2 "), docs.indexOf("### 8.3 "));
  const documented = [...section.matchAll(/^\| `([a-z_]+)/gm)]
    .map((m) => m[1])
    .sort();
  const parsed = JSON.parse(acl)["luci-app-aurora"];
  const exposed = [
    ...parsed.read.ubus["luci.aurora"],
    ...parsed.write.ubus["luci.aurora"],
  ]
    .filter((m) => /^(hub_|get_hub_)/.test(m))
    .sort();
  assert.deepEqual(documented, exposed);
});

// 浏览器直传之后,路由器不再需要把 1.2MB 的图 base64 塞进 JSON —— 实测
// uclient-fetch 走 TLS 推不动那么大的 body(512KB 三次挂一次,1MB 必断)。
// 它只需要告诉浏览器每个 kind 对应哪个本机文件。
//
// 第二列是相对 /luci-static/aurora/ 的路径而不是裸文件名:图片在 images/,
// 字体在 fonts/custom/,而 hub_share_begin 只会给这一列加前缀。
test("build_share_payload: emits a path sidecar, not base64", () => {
  assert.match(rpcd, /local out_file="\$1" files_file="\$\{1\}\.files"/);
  assert.match(rpcd, /printf '%s\\timages\/%s\\n' "\$kind" "\$fname" >> "\$files_file"/);
  assert.match(
    rpcd,
    /printf '%s\\tfonts\/custom\/%s\.woff2\\n' "font_\$slot" "\$base" >> "\$files_file"/,
  );
  assert.match(rpcd, /json_add_string "src" "\/luci-static\/aurora\/\$a_fname"/);
  assert.ok(!/base64 -w0/.test(rpcd), "base64 encoding should be gone");
  assert.ok(!/data_b64/.test(rpcd), "data_b64 should be gone from the rpcd script");
});

// 分享一份用了自定义字体的配置,却只发字体栈不发字节 —— 收到的人那台路由器上
// 根本没有那个字体族,浏览器静默回退到栈尾的 Lato:配色布局全对、字体没变,而
// 商店详情页还明明白白写着那个字体名。真机上抓到过这个现场(struct_font_sans
// 指着 "OPPO Sans Regular",aurora-font.css 里根本没有它的 @font-face)。
test("build_share_payload: uploaded custom fonts travel with the config", () => {
  assert.match(rpcd, /json_add_string "kind" "font_\$slot"/);
  // 名册预设不上传:接收端 sync_and_cache_fonts_from_uci 自己从固定源下载
  // 并校验,再传一份既浪费带宽也绕开了那份校验。
  assert.match(
    rpcd,
    /shared_custom_font_base\(\)[\s\S]*?get_font_preset_by_stack "\$slot" "\$stack" >\/dev\/null 2>&1 && return 1/,
  );
});

// 界面上说要发哪一份字体,和线路上真正打包哪一份,必须是同一个判断 —— 两处
// 各写一遍迟早漂移成"清单里写着、实际没发"。
test("the share manifest and the packer ask the same function", () => {
  const callers = rpcd.match(/shared_custom_font_base "\$slot"/g) || [];
  assert.ok(
    callers.length >= 2,
    "both build_share_payload and hub_local_state should call it",
  );
  assert.match(rpcd, /json_add_array "shared_fonts"/);
});

// 一律报 hub_unreachable 是"发布失败看起来像商店挂了"的全部原因:-q 把
// uclient-fetch 唯一会说出理由的那一行也吞了。hub_http_put/delete 一直会
// 区分 404,post 只是没跟上。
test("hub_http_post distinguishes a rejection from an outage", () => {
  assert.match(rpcd, /hub_http_post\(\)\s*\{[\s\S]*?2>"\$err"/);
  assert.match(rpcd, /HUB_HTTP_STATUS=/);
  assert.ok(
    !/wget -qO "\$out" --timeout=12/.test(rpcd),
    "-q swallowed the reason uclient-fetch prints",
  );
});

// 三段式发布：路由器建草稿拿票据 -> 浏览器直传字节 -> 路由器提交。
// 中间那段不经过路由器,因为 uclient-fetch 走 TLS 推不动大 body。
test("rpcd exposes the three-step publish", () => {
  for (const m of ["hub_share_begin", "hub_share_commit"]) {
    assert.match(rpcd, new RegExp(`json_add_object "${m}"`), `${m} missing from list`);
    assert.ok(rpcd.includes(`"${m}")`), `${m} missing from call`);
    assert.ok(acl.includes(`"${m}"`), `${m} missing from ACL write list`);
  }
});

test("hub_share_begin hands out local asset URLs, never the device token", () => {
  assert.match(rpcd, /\/luci-static\/aurora\/images\//);
  const begin = rpcd.slice(rpcd.indexOf('"hub_share_begin")'));
  const body = begin.slice(0, begin.indexOf("\n\t\t;;"));
  assert.match(body, /configs\/draft/);
  // 拼回复的那一段里不能出现 DEVICE_TOKEN
  const reply = body.slice(body.indexOf("json_add_array \"assets\""));
  assert.ok(!/DEVICE_TOKEN/.test(reply), "the device token must never reach the response");
});
