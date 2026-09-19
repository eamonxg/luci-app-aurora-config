"use strict";
"require baseclass";

const INDICATOR_ID = "aurora-inbox";
const STYLE_ID = "aurora-inbox-indicator";
const INBOX_PATH = "admin/system/aurora/marketplace";
const INBOX_HASH = "#inbox";

const INDICATOR = 'body[data-nav-type] #indicators span[data-indicator="' + INDICATOR_ID + '"]';

// Aurora 把指示器文字藏掉、按名字挂 mask 图标，不认识的名字是一块黑方块。
// 只在 body[data-nav-type]（Aurora）下生效；别的主题照常显示 LuCI 的文字指示器。
// 角标的几何与主题的 uci-changes 一致。
// order:1：主题的 #indicators 是 row-reverse，其余指示器都是默认的 0，
// 所以最大的 order 落在最左，原有的几个各自留在原位。
const INDICATOR_CSS =
  INDICATOR +
  "{position:relative;order:1;--aurora-inbox-icon:url(\"data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpath d='M22 12h-6l-2 3h-4l-2-3H2'/%3e%3cpath d='M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z'/%3e%3c/svg%3e\")}" +
  INDICATOR +
  "::before{-webkit-mask:var(--aurora-inbox-icon) center/cover no-repeat;mask:var(--aurora-inbox-icon) center/cover no-repeat}" +
  INDICATOR +
  "[data-count]::after{content:attr(data-count);position:absolute;top:-2px;right:-2px;z-index:10;" +
  "display:flex;align-items:center;justify-content:center;min-width:12px;min-height:12px;" +
  "padding:0 2px;border-radius:99px;background:var(--danger);color:var(--on-brand);" +
  "font-size:8px;font-weight:700;line-height:1;box-shadow:0 1px 2px rgba(0,0,0,.1)}";

const openInbox = () => {
  window.location.href = L.url(INBOX_PATH) + INBOX_HASH;
};

const update = () =>
  Promise.all([L.require("utils.notices"), L.require("utils.hub-api"), L.require("ui")]).then(
    ([notices, hubApi, ui]) => {
      const count = notices.badgeCount(
        hubApi.noticesCache.getStale(),
        hubApi.meCache.getStale(),
        hubApi.inboxState(),
      );
      if (!count) return ui.hideIndicator(INDICATOR_ID);

      if (!document.getElementById(STYLE_ID)) {
        const style = E("style", { id: STYLE_ID });
        style.textContent = INDICATOR_CSS;
        document.head.appendChild(style);
      }
      ui.showIndicator(INDICATOR_ID, _("Inbox") + " " + count, openInbox, "active");
      const node = document.querySelector('span[data-indicator="' + INDICATOR_ID + '"]');
      if (node) {
        node.setAttribute("data-count", count);
        node.title = node.textContent;
      }
    },
  );

const poll = (hubApi) =>
  L.require("uci").then((uci) =>
    uci.load("aurora").then(() => {
      const theme = uci.get("aurora", "theme");
      return !theme || theme.hub_notices === "0"
        ? hubApi.muteNotices()
        : hubApi.refreshNotices({ muted: false });
    }),
  );

const run = () =>
  Promise.all([L.require("utils.notices"), L.require("utils.hub-api")])
    .then(([notices, hubApi]) =>
      notices.isDue(hubApi.noticesCheckedAt(), Date.now()) ? poll(hubApi).catch(() => null) : null,
    )
    .then(update);

return baseclass.extend({
  INBOX_HASH: INBOX_HASH,

  __init__() {
    if (!L.env.sessionid) return;
    document.addEventListener(
      "luci-loaded",
      () =>
        (window.requestIdleCallback || window.setTimeout)(() =>
          Promise.resolve().then(run).catch(() => {}),
        ),
      { once: true },
    );
  },

  update() {
    return Promise.resolve().then(update).catch(() => {});
  },
});
