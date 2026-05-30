"use strict";
"require baseclass";
"require rpc";

const CACHE_KEY = "aurora.version.cache";
const CACHE_TTL = 1800000;

return baseclass.extend({
  versionCache: {
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

    set(value) {
      try {
        const data = { timestamp: Date.now(), value };
        localStorage.setItem(CACHE_KEY, JSON.stringify(data));
      } catch (e) {
        console.error("Failed to cache version data:", e);
      }
    },

    clear() {
      localStorage.removeItem(CACHE_KEY);
    },
  },

  callGetInstalledVersions: rpc.declare({
    object: "luci.aurora",
    method: "get_installed_versions",
  }),

  callCheckUpdates: rpc.declare({
    object: "luci.aurora",
    method: "check_updates",
  }),
});
