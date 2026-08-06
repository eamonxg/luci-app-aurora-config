"use strict";
"require baseclass";
"require rpc";

const CACHE_KEY = "aurora.hub.list";
const ME_CACHE_KEY = "aurora.hub.me";

const HUB_BASE = "https://themes.eamonxg.fun";
const HUB_TIMEOUT_MS = 15000;

// 浏览器直连 hub 的读路径。返回包络刻意与 rpcd 保持一致
// （{result:0,data} / {result:1,error}），marketplace.js 无需感知传输方式的变化。
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

// 资产字节走浏览器,不走路由器。原因不是"更快"(虽然确实快),是 OpenWrt 的
// uclient-fetch 走 TLS 根本推不动:实测同一台机器,512KB 三次里挂一次、1MB
// 必断("Connection reset prematurely"),而同机 curl 传 1.6MB 只要 3.4 秒
// —— 是它的 TLS 写路径在缓冲填满后不再续写。浏览器 fetch/XHR 没这个毛病。
//
// 浏览器拿到的是一张票据,不是 device_token:票据把 (draft_id, kind, size,
// sha256) 全钉死,泄漏了也只能把同一份字节再传一遍。device_token 是创作者
// 身份本身 —— 谁拿到谁能以你的名义发布、删掉你所有作品 —— 它留在路由器
// 那个 0600 的文件里。
//
// 用 XHR 而不是 fetch,只为了 upload.onprogress:一张 1.2MB 的图在慢上行的
// 线路上要传十几秒,没有进度条的等待会被当成卡死。
const putAssetBytes = (url, ticket, blob, onProgress) =>
  new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    xhr.setRequestHeader("Authorization", "Bearer " + ticket);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.timeout = 120000;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total);
    };
    xhr.onload = () => resolve(xhr.status >= 200 && xhr.status < 300);
    xhr.onerror = () => resolve(false);
    xhr.ontimeout = () => resolve(false);
    xhr.send(blob);
  });

// hub 的资产 url 是相对路径("/assets/{id}/{kind}"),和详情接口一直以来的
// 返回一致 —— 拼接 base 是客户端的活,这样缓存下来的列表里不会烙进主机名。
// HUB_BASE 归本模块所有,所以拼接也放在这里。
//
// 路径来自 hub,属于不可信输入,因此按 hub 唯一可能产出的形状做匹配,而不是
// 直接拼。其它一律返回 "",调用方退回纯色块。
const ASSET_PATH_RE = /^\/assets\/[A-Za-z0-9]{1,32}\/[a-z0-9_]{1,32}$/;

// 两份 localStorage 缓存的共同实现。它们只作首帧的种子:render 先用缓存画出
// 画面,随后 fetchSort / refreshMyShares 的结果无条件覆盖 —— 所以刻意不设
// TTL。到 hub 的每次往返都是 205ms 起步、首连约 800ms(TLS 握手不可复用),
// 一份"旧但立刻可用"的数据,比一次准确的白屏有用得多。
//
// 信封保留 timestamp:它没有读者,但在真机上翻 localStorage 时,它是唯一能看
// 出这帧画面有多旧的东西,而且保持了与旧版本写入的条目同形,无需迁移。
const makeCache = (key, label) => ({
  getStale() {
    try {
      const cached = localStorage.getItem(key);
      if (!cached) return null;
      return JSON.parse(cached).value ?? null;
    } catch (e) {
      return null;
    }
  },

  set(value) {
    try {
      localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), value }));
    } catch (e) {
      console.error("Failed to cache hub " + label + " data:", e);
    }
  },

  clear() {
    localStorage.removeItem(key);
  },
});

return baseclass.extend({
  listCache: makeCache(CACHE_KEY, "list"),

  meCache: makeCache(ME_CACHE_KEY, "me"),

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

  // 纯本地:回答「路由器现在穿的是哪一套、还是不是那一套、被盖掉的那套长什么
  // 样」。不走 hub,所以不进上面那套缓存 —— 它便宜到可以每次开页面都问一遍。
  callHubLocalState: rpc.declare({
    object: "luci.aurora",
    method: "hub_local_state",
  }),

  // 三段式发布的两端。中间那段(资产字节)由 publishCurrentConfig 用浏览器
  // 直接 PUT 到 hub —— 见下。target_id 为空串是新发布、非空是更新那一条,
  // 所以"更新分享"不需要自己的一套方法:它跟发布本来就是同一件事,只差目标。
  callHubShareBegin: rpc.declare({
    object: "luci.aurora",
    method: "hub_share_begin",
    params: ["name", "description", "target_id"],
  }),

  callHubShareCommit: rpc.declare({
    object: "luci.aurora",
    method: "hub_share_commit",
    params: ["draft_id"],
  }),

  // 发布一整套配置:路由器建草稿并拿票据 -> 浏览器把字节直接送到 hub ->
  // 路由器提交。返回的信封与其它 hub 调用一致({result:0,...})。
  publishCurrentConfig(options) {
    const opts = options || {};
    const report = (info) => {
      if (typeof opts.onProgress === "function") opts.onProgress(info);
    };

    report({ phase: "begin" });
    return L.resolveDefault(
      this.callHubShareBegin(opts.name, opts.description || "", opts.targetId || ""),
      null,
    ).then((begun) => {
      if (!begun || begun.result !== 0) {
        return { result: 1, error: (begun && begun.error) || "hub_unreachable" };
      }
      // 内容与已有的一模一样:hub 直接给了那条的 id,一个字节都不必传。
      if (begun.duplicate) return { result: 0, id: begun.id, duplicate: true };

      const entries = begun.assets || [];
      let index = 0;

      // 顺序上传,不并发:一台路由器的上行本来就窄,几条流互相抢只会让每一条
      // 都变慢,而进度条上也读不出"到底传到哪了"。
      const next = () => {
        if (index >= entries.length) {
          report({ phase: "commit" });
          // assets 是这一趟真正传上去的份数。调用方据此决定要不要提审核 ——
          // 它已经在手里,不必为一句话再往 hub 跑一趟。
          return L.resolveDefault(this.callHubShareCommit(begun.draft_id), null).then(
            (done) =>
              done && done.result === 0
                ? { result: 0, id: done.id, assets: entries.length }
                : { result: 1, error: (done && done.error) || "hub_unreachable" },
          );
        }

        const entry = entries[index];
        const position = { kind: entry.kind, index: index + 1, count: entries.length };
        index += 1;

        // 字节从路由器自己的 web 服务器上读,同源,不需要任何凭证。
        return fetch(entry.src)
          .then((res) => (res.ok ? res.blob() : null))
          .catch(() => null)
          .then((blob) => {
            if (!blob) return { result: 1, error: "asset_unreadable" };
            report({ phase: "upload", loaded: 0, total: blob.size, ...position });
            return putAssetBytes(HUB_BASE + entry.url, entry.ticket, blob, (loaded, total) =>
              report({ phase: "upload", loaded, total, ...position }),
            ).then((ok) => (ok ? next() : { result: 1, error: "asset_upload_failed" }));
          });
      };

      return next();
    });
  },

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

  callHubDelete: rpc.declare({
    object: "luci.aurora",
    method: "hub_delete",
    params: ["id"],
  }),
});
