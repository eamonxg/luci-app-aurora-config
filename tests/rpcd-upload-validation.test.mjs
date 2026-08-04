import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const SRC = "root/usr/libexec/rpcd/luci.aurora";

test("rpcd defines shared MAX_UPLOAD and receive_upload()", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /readonly MAX_UPLOAD=8388608/);
  assert.ok(!src.includes("FONT_MAX_UPLOAD"), "FONT_MAX_UPLOAD must be renamed");
  assert.match(src, /^receive_upload\(\)/m);
});

test("upload_font and upload_icon route through receive_upload", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /receive_upload "\$FONT_TMP_UPLOAD" font \|\| exit 0/);
  assert.match(
    src,
    /receive_upload "\$TMP_UPLOAD_PATH" image "\$filename" \|\| exit 0/,
  );
});

test("image allowlist covers favicon .ico and every advertised format", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /jpg\|jpeg\|png\|webp\|avif\|svg\|gif\|ico/);
});

test("list endpoints expose byte sizes", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /json_add_int "size" "\$csize"/);
  assert.match(src, /json_add_object "icon_sizes"/);
});

test("both upload mv sites are guarded and clean tmp on failure", async () => {
  const src = await readFile(SRC, "utf8");
  assert.match(src, /if ! mv "\$FONT_TMP_UPLOAD"/);
  assert.match(src, /if mv "\$TMP_UPLOAD_PATH"/);
  const storeErrors = src.match(/Failed to store file/g) || [];
  assert.equal(storeErrors.length, 2, "font and icon mv failure paths");
});

test("remove_icon clears every uci slot that named the deleted file", async () => {
  const src = await readFile(SRC, "utf8");
  const start = src.indexOf('"remove_icon")');
  const end = src.indexOf('"write_pwa_manifest")');
  assert.ok(start !== -1 && end > start, "remove_icon handler missing");
  const body = src.slice(start, end);

  // 删掉的图片可能同时是 logo/favicon/PWA 图标/iOS 主屏图标/工具栏快捷方式的
  // 图标 —— 只清一部分就会让 uci 指向一个已经不存在的文件:主题 404,分享
  // 清单还在承诺它。
  assert.match(
    body,
    /for icon_slot in logo_svg favicon_png favicon_ico pwa_icon_192 pwa_icon_512 pwa_apple_touch; do/,
    "every theme-level image slot must be cleared, not just the login background",
  );
  assert.match(body, /uci -q delete "aurora\.theme\.\$icon_slot"/);
  assert.match(body, /uci -q delete aurora\.theme\.struct_login_bg$/m);

  // 工具栏项的 icon 也指向同一批上传图标,而且 build_share_payload 会把它
  // 当普通字符串发到 hub —— 悬空的名字会被每个应用者继承。
  assert.match(
    body,
    /sed -n 's\/\^aurora\\\.\\\(\[\^\.=\]\*\\\)=toolbar_item\$\/\\1\/p'/,
    "anonymous toolbar_item sections must be enumerated the way build_share_payload does",
  );
  assert.match(
    body,
    /uci -q get "aurora\.\$toolbar_sid\.icon"/,
    "each toolbar shortcut's icon must be checked against the deleted file",
  );
  assert.match(body, /uci -q delete "aurora\.\$toolbar_sid\.icon"/);
  assert.ok(
    !/\[[0-9]+\]\.icon/.test(body),
    "toolbar sections are anonymous -- never address them by index",
  );

  // 既有的 .. 防护必须留着
  assert.ok(
    body.includes('dirname "$filename" | grep -q "\\.\\."'),
    "the .. traversal guard must survive",
  );

  // 仍然只提交一次,且只在真的改了东西时提交
  const commits = body.match(/uci -q commit aurora/g) || [];
  assert.equal(commits.length, 1, "exactly one commit for the whole removal");
  assert.match(
    body,
    /\[ "\$icon_slot_cleared" = 1 \] && uci -q commit aurora/,
    "the commit must be conditional on something having changed",
  );

  // BusyBox ash:没有数组、没有 [[、函数外没有 local
  assert.ok(!body.includes("[["), "no bash [[ in remove_icon");
  assert.ok(!/^\s*local /m.test(body), "no local outside a function");
});
