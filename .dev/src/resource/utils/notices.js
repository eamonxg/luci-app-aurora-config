"use strict";
"require baseclass";

const POLL_INTERVAL_MS = 12 * 60 * 60 * 1000;
const MAX_NOTICES = 20;
const MAX_TITLE_CHARS = 120;
const MAX_BODY_CHARS = 4000;
const MAX_REASON_CHARS = 1000;
const MAX_VERSION_CHARS = 64;

const ID_RE = /^[A-Za-z0-9]{1,32}$/;
const LANG_RE = /^[a-z]{2}(-[a-z]{2,4})?$/;
const LEVELS = ["info", "warning", "critical"];
const BADGE_LEVELS = ["warning", "critical"];
const AUDIENCES = ["all", "creators"];
const COMPAT_STATES = ["unsupported", "deprecated"];

const HTTPS_PREFIX = "https://";
const LUCI_PATH_RE = /^admin\/[A-Za-z0-9_\-./?=&%#]*$/;
const URL_FORBIDDEN_RE = /[\u0000-\u0020\u007f\\]/;
const STAMP_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/;
const SUNSET_DATE_RE = /^\d{4}-\d{2}-\d{2}(?=$|[ T])/;

const GROUP_ACTION = "action";
const GROUP_UPDATES = "updates";
const SOURCE_ROUTER = "router";
const SOURCE_SHARES = "shares";
const SOURCE_STORE = "store";
const FEED_KEY = "feed:missing";
const LOCAL_KEY_PREFIX = "feed:";
const DERIVED_KEY_MARK = ":";

const AGE_STEPS = [
  ["week", 7 * 24 * 60 * 60 * 1000],
  ["day", 24 * 60 * 60 * 1000],
  ["hour", 60 * 60 * 1000],
  ["minute", 60 * 1000],
];

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

// 按码点计数：hub 的上限数的是字符，而 .length 数的是 UTF-16 码元。
const charCount = (value) => Array.from(value).length;

const isTitle = (value) =>
  typeof value === "string" &&
  value.trim() !== "" &&
  charCount(value) <= MAX_TITLE_CHARS;

const isBody = (value) =>
  typeof value === "string" && charCount(value) <= MAX_BODY_CHARS;

const cleanI18n = (i18n) => {
  const out = {};
  if (!isObject(i18n)) return out;
  Object.keys(i18n).forEach((lang) => {
    const entry = i18n[lang];
    if (!LANG_RE.test(lang) || !isObject(entry)) return;
    const kept = {};
    if (isTitle(entry.title)) kept.title = entry.title;
    if (isBody(entry.body) && entry.body !== "") kept.body = entry.body;
    if (Object.keys(kept).length) out[lang] = kept;
  });
  return out;
};

const stampOf = (value) => {
  const match = typeof value === "string" ? STAMP_RE.exec(value) : null;
  return match ? match[0] : "";
};

const cleanNotice = (raw) => {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== "string" || !ID_RE.test(raw.id)) return null;
  if (!LEVELS.includes(raw.level) || !AUDIENCES.includes(raw.audience)) return null;
  if (!isTitle(raw.title) || !isBody(raw.body)) return null;
  return {
    id: raw.id,
    level: raw.level,
    audience: raw.audience,
    title: raw.title,
    body: raw.body,
    url: typeof raw.url === "string" ? raw.url : "",
    i18n: cleanI18n(raw.i18n),
    at: stampOf(raw.starts_at) || stampOf(raw.at) || stampOf(raw.created_at),
  };
};

const stringList = (value) =>
  Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];

const ownConfigs = (me) =>
  isObject(me) && Array.isArray(me.configs)
    ? me.configs.filter(
        (config) => isObject(config) && typeof config.id === "string" && ID_RE.test(config.id),
      )
    : [];

const isReason = (value) =>
  typeof value === "string" && charCount(value) <= MAX_REASON_CHARS;

const versionOf = (pkg) => {
  const version = isObject(pkg) ? pkg.installed_version : null;
  return typeof version === "string" && charCount(version) <= MAX_VERSION_CHARS ? version : "";
};

const nameOf = (config) => (typeof config.name === "string" ? config.name : "");

// FNV-1a，32 位。只为让"受影响的那一组 id"一变键就变，不承担任何安全含义。
const shortHash = (text) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};

return baseclass.extend({
  POLL_INTERVAL_MS: POLL_INTERVAL_MS,
  MAX_NOTICES: MAX_NOTICES,
  GROUP_ACTION: GROUP_ACTION,
  GROUP_UPDATES: GROUP_UPDATES,
  SOURCE_ROUTER: SOURCE_ROUTER,
  SOURCE_SHARES: SOURCE_SHARES,
  SOURCE_STORE: SOURCE_STORE,
  FEED_KEY: FEED_KEY,

  localize(notice, lang) {
    const source = isObject(notice) ? notice : {};
    const i18n = isObject(source.i18n) ? source.i18n : {};
    const code = String(lang == null ? "" : lang).toLowerCase().replace(/_/g, "-");
    const chain = [i18n[code], i18n[code.split("-")[0]], source];
    const pick = (field) => {
      const hit = chain.find(
        (entry) => isObject(entry) && typeof entry[field] === "string" && entry[field] !== "",
      );
      return hit ? hit[field] : "";
    };
    return { title: pick("title"), body: pick("body") };
  },

  safeUrl(url) {
    if (typeof url !== "string" || URL_FORBIDDEN_RE.test(url)) return "";
    if (LUCI_PATH_RE.test(url))
      return url.includes("..") || url.includes("//") ? "" : url;
    if (!url.startsWith(HTTPS_PREFIX)) return "";
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || !parsed.hostname) return "";
      if (parsed.username || parsed.password) return "";
      return url;
    } catch (e) {
      return "";
    }
  },

  isExternalUrl(url) {
    return typeof url === "string" && url.startsWith(HTTPS_PREFIX);
  },

  present(notice, lang) {
    const text = this.localize(notice, lang);
    const url = this.safeUrl(notice?.url);
    return {
      title: text.title,
      body: text.body,
      url: url,
      external: this.isExternalUrl(url),
    };
  },

  sanitize(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    for (const raw of list) {
      if (out.length >= MAX_NOTICES) break;
      const notice = cleanNotice(raw);
      if (notice && !out.some((kept) => kept.id === notice.id)) out.push(notice);
    }
    return out;
  },

  isDue(lastCheckedMs, nowMs) {
    if (!Number.isFinite(lastCheckedMs) || lastCheckedMs <= 0) return true;
    if (!Number.isFinite(nowMs) || nowMs < lastCheckedMs) return true;
    return nowMs - lastCheckedMs >= POLL_INTERVAL_MS;
  },

  creatorAffected(me) {
    if (!isObject(me)) return false;
    const summary = isObject(me.compat_summary) ? me.compat_summary : {};
    const count = (field) => (Number.isFinite(summary[field]) ? summary[field] : 0);
    if (count("deprecated") + count("unsupported") > 0) return true;
    return (Array.isArray(me.configs) ? me.configs : []).some((config) => {
      if (!isObject(config) || config.status === "removed") return false;
      const state = isObject(config.compat) ? config.compat.state : null;
      return typeof state === "string" && state !== "ok";
    });
  },

  hasShares(me) {
    return ownConfigs(me).length > 0;
  },

  compatBadge(config) {
    const state = config?.compat?.state;
    return COMPAT_STATES.includes(state) ? state : null;
  },

  sunsetDate(config) {
    const stamp = config?.compat?.sunset_at;
    const match = typeof stamp === "string" ? SUNSET_DATE_RE.exec(stamp) : null;
    return match ? match[0] : "";
  },

  compatCounts(me) {
    const counts = { deprecated: 0, unsupported: 0, sunset: "" };
    ownConfigs(me)
      .filter((config) => config.status !== "removed")
      .forEach((config) => {
        const state = this.compatBadge(config);
        if (state) counts[state] += 1;
        const sunset = state === "deprecated" ? this.sunsetDate(config) : "";
        if (sunset && (!counts.sunset || sunset < counts.sunset)) counts.sunset = sunset;
      });
    if (isObject(me) && isObject(me.compat_summary))
      ["deprecated", "unsupported"].forEach((state) => {
        const n = me.compat_summary[state];
        counts[state] = Number.isInteger(n) && n > 0 ? n : 0;
      });
    return counts;
  },

  shortHash: shortHash,

  derive(me) {
    const configs = ownConfigs(me);
    const live = configs.filter((config) => config.status !== "removed");
    const items = [];

    COMPAT_STATES.forEach((state) => {
      const hit = live.filter((config) => this.compatBadge(config) === state);
      if (!hit.length) return;
      const sunsets = hit
        .map((config) => this.sunsetDate(config))
        .filter((day) => day)
        .sort();
      items.push({
        key:
          "compat:" +
          state +
          ":" +
          shortHash(
            hit
              .map((config) => config.id)
              .sort()
              .join(","),
          ),
        group: GROUP_ACTION,
        source: SOURCE_SHARES,
        kind: "compat",
        state: state,
        level: "critical",
        names: hit.map(nameOf),
        sunset: state === "deprecated" && sunsets.length ? sunsets[0] : "",
      });
    });

    live
      .filter((config) => config.assets_status === "rejected")
      .forEach((config) =>
        items.push({
          key: "rejected:" + config.id,
          group: GROUP_ACTION,
          source: SOURCE_SHARES,
          kind: "rejected",
          level: "warning",
          name: nameOf(config),
          reason: isReason(config.assets_reject_reason) ? config.assets_reject_reason : "",
        }),
      );

    configs
      .filter((config) => config.status === "removed")
      .forEach((config) =>
        items.push({
          key: "removed:" + config.id,
          group: GROUP_ACTION,
          source: SOURCE_SHARES,
          kind: "removed",
          level: "warning",
          name: nameOf(config),
        }),
      );

    return items;
  },

  // get_init_data 的应答 -> 随 feed 一起缓存的本机结论。判断不出来（没有 feed
  // 字段、包管理器未知）就是 null：不知道，不等于"缺"。
  localState(initData) {
    const feed = isObject(initData) && isObject(initData.feed) ? initData.feed : null;
    if (!feed || typeof feed.pm !== "string" || feed.pm === "" || feed.pm === "unknown")
      return null;
    const versions = isObject(initData.versions) ? initData.versions : {};
    return {
      feedMissing: feed.configured !== true,
      theme: versionOf(versions.theme),
      app: versionOf(versions.config),
    };
  },

  deriveLocal(local) {
    if (!isObject(local) || local.feedMissing !== true) return [];
    return [
      {
        key: FEED_KEY,
        group: GROUP_ACTION,
        source: SOURCE_ROUTER,
        kind: "feed",
        level: "warning",
        theme: typeof local.theme === "string" ? local.theme : "",
        app: typeof local.app === "string" ? local.app : "",
      },
    ];
  },

  inbox(snapshot, me, state) {
    const read = stringList(state && state.read);
    const done = stringList(state && state.done);
    const affected = this.creatorAffected(me);
    const updates = this.sanitize(isObject(snapshot) ? snapshot.notices : null)
      .filter((notice) => notice.audience !== "creators" || affected)
      .map((notice) => ({
        key: notice.id,
        group: GROUP_UPDATES,
        source: SOURCE_STORE,
        kind: "notice",
        level: notice.level,
        at: notice.at,
        notice: notice,
      }));
    return this.deriveLocal(isObject(snapshot) ? snapshot.local : null)
      .concat(this.derive(me), updates)
      .filter((item) => !done.includes(item.key))
      .map((item) => Object.assign(item, { unread: !read.includes(item.key) }));
  },

  unreadCount(items) {
    return (Array.isArray(items) ? items : []).filter((item) => item && item.unread).length;
  },

  badgeCount(snapshot, me, state) {
    if (!isObject(snapshot)) return 0;
    return this.inbox(snapshot, me, state).filter(
      (item) =>
        item.unread && (item.group === GROUP_ACTION || BADGE_LEVELS.includes(item.level)),
    ).length;
  },

  withKey(keys, key) {
    const list = stringList(keys);
    return typeof key !== "string" || list.includes(key) ? list : list.concat(key);
  },

  withoutKey(keys, key) {
    return stringList(keys).filter((kept) => kept !== key);
  },

  withKeys(keys, items) {
    return (Array.isArray(items) ? items : []).reduce(
      (list, item) => this.withKey(list, item && item.key),
      stringList(keys),
    );
  },

  // 某一路来源这次没拿到（hub 不通、hub_me 失败）时，它名下的键原样保留：
  // 否则一次断网就把 Done 过的条目全放回来。
  pruneKeys(keys, activeKeys, known) {
    const active = stringList(activeKeys);
    const unknown = (key) => {
      if (key.startsWith(LOCAL_KEY_PREFIX)) return !(known && known.local);
      if (key.includes(DERIVED_KEY_MARK)) return !(known && known.me);
      return !(known && known.feed);
    };
    return stringList(keys).filter(
      (key, index, all) => all.indexOf(key) === index && (active.includes(key) || unknown(key)),
    );
  },

  stampMs(stamp) {
    const match = typeof stamp === "string" ? STAMP_RE.exec(stamp) : null;
    if (!match) return null;
    const [year, month, day, hour, minute, second] = match
      .slice(1)
      .map((part) => Number(part || 0));
    const ms = Date.UTC(year, month - 1, day, hour, minute, second);
    return Number.isFinite(ms) ? ms : null;
  },

  ageOf(thenMs, nowMs) {
    if (!Number.isFinite(thenMs) || !Number.isFinite(nowMs)) return null;
    const elapsed = Math.max(0, nowMs - thenMs);
    const step = AGE_STEPS.find((candidate) => elapsed >= candidate[1]);
    return step
      ? { value: -Math.floor(elapsed / step[1]), unit: step[0] }
      : { value: 0, unit: "minute" };
  },
});
