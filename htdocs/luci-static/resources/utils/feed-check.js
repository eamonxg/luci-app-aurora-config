"use strict";
"require baseclass";

// 更新源相关的纯判断：版本比对与软件包页定位。
// 刻意不碰 DOM、不发请求 —— 这样它们能被真正单元测试，而不是只做正则断言。

// 软件包页的地址在各 OpenWrt 版本间不一致（主题支持 23.05 及以后）：
// snapshot 上实测是 package-manager，更早的版本用 opkg。不硬编码猜测，而是
// 从 ui.menu.load() 的真实菜单树里找，顺带覆盖两种本来要单独处理的情况：
// 用户无权访问该页（节点带 satisfied:false），以及精简固件根本没装这个页面。
const PACKAGE_PAGE_CANDIDATES = ["package-manager", "opkg", "packages"];

return baseclass.extend({
  PACKAGE_PAGE_CANDIDATES: PACKAGE_PAGE_CANDIDATES,

  // "1.1.3-r20260803" → 20260803；其余形态一律 null。
  parseRevision: function (version) {
    const match = /-r(\d{8})\b/.exec(String(version == null ? "" : version));
    return match ? Number(match[1]) : null;
  },

  // install.sh 写明 opkg 与 apk 的版本方案不可比较、脚本从不排序它们。
  // 这里沿用同一条纪律：只有两边都带 rYYYYMMDD 戳时才敢说"有新版"。
  // 判不出来就沉默 —— 误报"有新版"比不报更糟。
  isNewer: function (installed, available) {
    const a = this.parseRevision(installed);
    const b = this.parseRevision(available);
    if (a === null || b === null) return false;
    return b > a;
  },

  // 从 manifest.json 里取某渠道某包的版本。结构由 feed 的 gen-manifest.sh
  // 生成：channels[渠道][格式] 是一个 {pkg, version} 数组。
  findManifestVersion: function (manifest, channel, format, pkg) {
    const entries = manifest?.channels?.[channel]?.[format];
    if (!Array.isArray(entries)) return null;
    const hit = entries.find((entry) => entry?.pkg === pkg);
    return hit?.version || null;
  },

  pickPackageManagerPath: function (menuTree) {
    const system = menuTree?.children?.admin?.children?.system?.children;
    if (!system) return null;
    const name = PACKAGE_PAGE_CANDIDATES.find((candidate) => {
      const node = system[candidate];
      // ui.menu 保留无权限的节点但标记 satisfied:false（getChildren 就是按它
      // 过滤的）。不检查这个的话，会给没权限的用户渲染出一条点了吃 403 的链接。
      return node && node.satisfied !== false;
    });
    return name ? `admin/system/${name}` : null;
  },
});
