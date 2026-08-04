"use strict";
"require baseclass";
"require rpc";

const CACHE_KEY = "aurora.hub.list";
const CACHE_TTL = 300000;

const HUB_BASE = "https://themes.eamonxg.fun";
const HUB_TIMEOUT_MS = 15000;

// 浏览器直连 hub 的读路径。返回包络刻意与 rpcd 保持一致
// （{result:0,data} / {result:1,error}），gallery.js 无需感知传输方式的变化。
const hubFetch = (path) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HUB_TIMEOUT_MS);
  return fetch(HUB_BASE + path, {
    signal: controller.signal,
    headers: { Accept: "application/json" },
  })
    .then((res) => {
      if (res.status === 404) return { result: 1, error: "invalid_id" };
      if (!res.ok) return { result: 1, error: "hub_unreachable" };
      return res.json().then((data) => ({ result: 0, data }));
    })
    .catch(() => ({ result: 1, error: "hub_unreachable" }))
    .finally(() => clearTimeout(timer));
};

// hub 的资产 url 是相对路径("/assets/{id}/{kind}"),和详情接口一直以来的
// 返回一致 —— 拼接 base 是客户端的活,这样缓存下来的列表里不会烙进主机名。
// HUB_BASE 归本模块所有,所以拼接也放在这里。
//
// 路径来自 hub,属于不可信输入,因此按 hub 唯一可能产出的形状做匹配,而不是
// 直接拼。其它一律返回 "",调用方退回纯色块。
const ASSET_PATH_RE = /^\/assets\/[A-Za-z0-9]{1,32}\/[a-z0-9_]{1,32}$/;

return baseclass.extend({
  listCache: {
    get() {
      try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (!cached) return null;
        const { timestamp, value } = JSON.parse(cached);
        if (Date.now() - timestamp > CACHE_TTL) {
          this.clear();
          return null;
        }
        return value;
      } catch (e) {
        return null;
      }
    },

    getStale() {
      try {
        const cached = localStorage.getItem(CACHE_KEY);
        if (!cached) return null;
        return JSON.parse(cached).value ?? null;
      } catch (e) {
        return null;
      }
    },

    set(value) {
      try {
        localStorage.setItem(
          CACHE_KEY,
          JSON.stringify({ timestamp: Date.now(), value }),
        );
      } catch (e) {
        console.error("Failed to cache hub list data:", e);
      }
    },

    clear() {
      localStorage.removeItem(CACHE_KEY);
    },
  },

  callHubList(sort, page) {
    const safeSort = sort === "new" ? "new" : "hot";
    const safePage = Number.isInteger(page) && page > 0 ? page : 1;
    return hubFetch(
      "/api/v1/themes/aurora/configs?sort=" + safeSort + "&page=" + safePage,
    );
  },

  callHubGet(id) {
    if (!/^[A-Za-z0-9]+$/.test(String(id || ""))) {
      return Promise.resolve({ result: 1, error: "invalid_id" });
    }
    return hubFetch("/api/v1/themes/aurora/configs/" + id);
  },

  hubAssetUrl(path) {
    return typeof path === "string" && ASSET_PATH_RE.test(path)
      ? HUB_BASE + path
      : "";
  },

  callHubApply: rpc.declare({
    object: "luci.aurora",
    method: "hub_apply",
    params: ["id"],
  }),

  callGetHubStatus: rpc.declare({
    object: "luci.aurora",
    method: "get_hub_status",
    params: ["job_id"],
  }),

  callHubRestore: rpc.declare({
    object: "luci.aurora",
    method: "hub_restore_backup",
  }),

  // No author parameter: signing is an account property the hub resolves from
  // the device token, not something a publish call gets to choose.
  callHubShare: rpc.declare({
    object: "luci.aurora",
    method: "hub_share",
    params: ["name", "description"],
  }),

  callHubSetNickname: rpc.declare({
    object: "luci.aurora",
    method: "hub_set_nickname",
    params: ["nickname"],
  }),

  callHubMe: rpc.declare({
    object: "luci.aurora",
    method: "hub_me",
  }),

  // Both sit behind the write ACL: the key is the creator account's password,
  // so reading it out is as much a privileged act as replacing it.
  callHubExportKey: rpc.declare({
    object: "luci.aurora",
    method: "hub_export_key",
  }),

  callHubImportKey: rpc.declare({
    object: "luci.aurora",
    method: "hub_import_key",
    params: ["key"],
  }),

  callHubUpdate: rpc.declare({
    object: "luci.aurora",
    method: "hub_update",
    params: ["id", "name", "description"],
  }),

  callHubDelete: rpc.declare({
    object: "luci.aurora",
    method: "hub_delete",
    params: ["id"],
  }),
});
