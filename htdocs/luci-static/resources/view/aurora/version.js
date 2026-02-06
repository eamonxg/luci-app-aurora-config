"use strict";
"require view";
"require rpc";
"require ui";

const CACHE_KEY = "aurora.version.cache";
const CACHE_TTL = 1800000;

const versionCache = {
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
};

const callGetInstalledVersions = rpc.declare({
  object: "luci.aurora",
  method: "get_installed_versions",
});

const callCheckUpdates = rpc.declare({
  object: "luci.aurora",
  method: "check_updates",
});

const callDownloadPackage = rpc.declare({
  object: "luci.aurora",
  method: "download_package",
  params: ["repo", "version", "package_filter"],
});

const callInstallPackage = rpc.declare({
  object: "luci.aurora",
  method: "install_package",
  params: ["package", "file_path"],
  expect: { result: 0 },
});

const versionData = {
  installed: {},
  updates: {},
  i18n: {},
};

const handleUpdate = (ev) => {
  const packageName = ev.target.getAttribute("data-package");
  const repo = ev.target.getAttribute("data-repo");
  const version = ev.target.getAttribute("data-version");
  const displayName = ev.target.getAttribute("data-display-name");
  const packageFilter = ev.target.getAttribute("data-package-filter");

  ui.showModal(_(`Update Package`), [
    E(
      "p",
      {},
      _(
        `Are you sure you want to update <strong>%h</strong> to version <strong>%h</strong>?`,
      ).format(displayName, version),
    ),
    E("div", { class: "right" }, [
      E(
        "div",
        {
          class: "btn",
          click: ui.hideModal,
        },
        _("Cancel"),
      ),
      " ",
      E(
        "div",
        {
          class: "btn cbi-button-positive",
          click: () => {
            executeUpdate(packageName, repo, version, packageFilter);
          },
        },
        _("Update"),
      ),
    ]),
  ]);
};

const executeUpdate = (packageName, repo, version, packageFilter) => {
  const dlg = ui.showModal(_("Updating Package"), [
    E("p", { class: "spinning" }, _("Downloading update files...")),
  ]);

  callDownloadPackage(repo, version, packageFilter || "")
    .then((downloadResult) => {
      if (!downloadResult || downloadResult.result !== 0) {
        throw new Error(downloadResult?.error || "Download failed");
      }

      dlg.removeChild(dlg.lastChild);
      dlg.appendChild(
        E("p", { class: "spinning" }, _("Installing update packages...")),
      );

      const files = downloadResult.files.trim().split(/\s+/);
      const outputs = [];
      let installPromise = Promise.resolve();

      files.forEach((file) => {
        installPromise = installPromise.then(() =>
          callInstallPackage(packageName, file)
            .then((result) => {
              if (result.output) outputs.push(result.output);
              return result;
            })
            .catch((err) => {
              if (err.message && err.message.includes("timed out")) {
                return {
                  result: 0,
                  message:
                    "Installation completed (connection timeout during verification)",
                };
              }
              throw err;
            }),
        );
      });

      return installPromise.then(() => outputs);
    })
    .then((outputs) => {
      dlg.removeChild(dlg.lastChild);

      if (outputs && outputs.length > 0) {
        dlg.appendChild(E("h5", {}, _("Installation Details")));
        outputs.forEach((output) => {
          if (output) {
            dlg.appendChild(E("pre", {}, output));
          }
        });
      }

      dlg.appendChild(
        E(
          "p",
          {},
          _(
            "Update completed successfully! Please reload the page to see the changes. If the old version still appears, try again in an incognito/private window or after clearing your browser cache.",
          ),
        ),
      );
      dlg.appendChild(
        E("div", { class: "right" }, [
          E(
            "div",
            {
              class: "btn cbi-button-positive",
              click: () => {
                versionCache.clear();
                ui.hideModal();
                window.location.reload();
              },
            },
            _("Reload"),
          ),
        ]),
      );
    })
    .catch((err) => {
      dlg.removeChild(dlg.lastChild);
      dlg.appendChild(
        E(
          "p",
          { class: "alert-message error" },
          _(`Update failed: %s`).format(err.message || err),
        ),
      );
      dlg.appendChild(
        E("div", { class: "right" }, [
          E(
            "div",
            {
              class: "btn",
              click: ui.hideModal,
            },
            _("Close"),
          ),
        ]),
      );
    });
};

const createUpdateButton = (
  packageName,
  latest,
  updateAvailable,
  displayName,
  repo,
  isI18n = false,
) => {
  if (updateAvailable && latest !== _("Unknown")) {
    const btnAttrs = {
      class: "btn cbi-button-positive",
      "data-package": packageName,
      "data-repo": repo,
      "data-version": latest,
      "data-display-name": displayName,
      click: handleUpdate,
    };

    if (isI18n) {
      btnAttrs["data-package-filter"] = packageName;
    }

    return E("div", btnAttrs, _("Update"));
  } else if (latest === _("Unknown") && updateAvailable === false) {
    return E("span", { class: "label info" }, _("Unknown"));
  } else {
    return E("span", { class: "label success" }, _("Up to date"));
  }
};

const updateVersionTable = (updateInfo) => {
  const rows = [];

  const packages = [
    { key: "theme", name: "luci-theme-aurora", display: "luci-theme-aurora" },
    {
      key: "config",
      name: "luci-app-aurora-config",
      display: "luci-app-aurora-config",
    },
  ];

  packages.forEach((pkg) => {
    const installed = versionData.installed[pkg.key] || _("Not installed");
    let latest = updateInfo ? _("Unknown") : _("Checking for updates...");
    let canUpdate = false;

    if (updateInfo && updateInfo[pkg.key]) {
      latest = updateInfo[pkg.key].latest_version || _("Unknown");
      canUpdate = updateInfo[pkg.key].update_available;
    }

    rows.push([
      pkg.display,
      installed,
      latest,
      updateInfo
        ? createUpdateButton(pkg.key, latest, canUpdate, pkg.display, pkg.name)
        : E("span", { class: "label info" }, _("Checking...")),
    ]);

    const i18nPackages = versionData.i18n[pkg.key] || "";
    if (i18nPackages) {
      i18nPackages.split(",").forEach((item) => {
        const parts = item.split(":");
        const i18nName = parts[0];
        const i18nVersion = parts[1] || installed;

        let i18nLatest = updateInfo
          ? _("Unknown")
          : _("Checking for updates...");
        let i18nCanUpdate = false;

        const parentLatest = updateInfo
          ? updateInfo[pkg.key]?.latest_version || _("Unknown")
          : _("Unknown");

        if (updateInfo && updateInfo.i18n && updateInfo.i18n[i18nName]) {
          i18nLatest = updateInfo.i18n[i18nName].latest_version || _("Unknown");
          i18nCanUpdate = updateInfo.i18n[i18nName].update_available;
        }

        rows.push([
          i18nName,
          i18nVersion,
          i18nLatest,
          updateInfo
            ? createUpdateButton(
                i18nName,
                parentLatest,
                i18nCanUpdate,
                i18nName,
                pkg.name,
                true,
              )
            : E("span", { class: "label info" }, _("Checking...")),
        ]);
      });
    }
  });

  cbi_update_table(
    "#version-table",
    rows,
    E("em", {}, _("No packages found. Please check your installation.")),
  );
};

const checkForUpdates = (forceRefresh) => {
  const btn = document.querySelector('button[data-action="check-updates"]');
  if (btn) {
    btn.disabled = true;
    btn.classList.add("spinning");
  }

  if (!forceRefresh) {
    const cached = versionCache.get();
    if (cached) {
      updateVersionTable(cached);
      if (btn) {
        btn.disabled = false;
        btn.classList.remove("spinning");
      }
      return;
    }
  }

  updateVersionTable(null);

  callCheckUpdates()
    .then((updateData) => {
      versionCache.set(updateData);
      updateVersionTable(updateData);
      if (btn) {
        btn.disabled = false;
        btn.classList.remove("spinning");
      }
    })
    .catch((err) => {
      console.error("Failed to check updates:", err);
      if (btn) {
        btn.disabled = false;
        btn.classList.remove("spinning");
      }
      ui.addNotification(
        null,
        E(
          "p",
          {},
          _(
            `Failed to check for updates: %s. Please check your internet connection.`,
          ).format(err.message || err),
        ),
        "error",
      );
    });
};

return view.extend({
  load: () => L.resolveDefault(callGetInstalledVersions(), null),

  render: (installedData) => {
    if (installedData) {
      versionData.installed = {
        theme: installedData.theme?.installed_version,
        config: installedData.config?.installed_version,
      };
      versionData.i18n = {
        theme: installedData.theme?.i18n_packages || "",
        config: installedData.config?.i18n_packages || "",
      };
    }

    const view = E(
      [],
      [
        E("h2", {}, _("Version Management")),

        E("div", { class: "cbi-map-descr" }, [
          _(
            "Check for and install updates for Aurora theme and configuration packages. Updates are downloaded from the latest releases of the Aurora theme and configuration plugin GitHub repositories.",
          ),
          " ",
          E(
            "a",
            {
              href: "https://github.com/eamonxg/luci-theme-aurora/releases/latest",
              target: "_blank",
              rel: "noreferrer",
            },
            "Theme Releases",
          ),
          " ",
          E(
            "a",
            {
              href: "https://github.com/eamonxg/luci-app-aurora-config/releases/latest",
              target: "_blank",
              rel: "noreferrer",
            },
            "Config Releases",
          ),
        ]),

        E("div", { style: "margin: 1em 0" }, [
          E(
            "button",
            {
              class: "cbi-button cbi-button-action",
              "data-action": "check-updates",
              click: () => {
                checkForUpdates(true);
              },
            },
            _("Check for Updates"),
          ),
        ]),

        E("table", { id: "version-table", class: "table" }, [
          E("tr", { class: "tr cbi-section-table-titles" }, [
            E("th", { class: "th col-3 left" }, _("Package Name")),
            E("th", { class: "th col-3 left" }, _("Installed Version")),
            E("th", { class: "th col-3 left" }, _("Latest Version")),
            E(
              "th",
              { class: "th col-3 center cbi-section-actions" },
              _("Status"),
            ),
          ]),
        ]),
      ],
    );

    requestAnimationFrame(() => {
      checkForUpdates(false);
    });

    return view;
  },

  handleSave: null,
  handleSaveApply: null,
  handleReset: null,
});
