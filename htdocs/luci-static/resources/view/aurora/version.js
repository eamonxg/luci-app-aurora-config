"use strict";
"require view";
"require rpc";
"require ui";

const callGetInstalledVersions = rpc.declare({
  object: "luci.aurora",
  method: "get_installed_versions",
});

const callCheckUpdates = rpc.declare({
  object: "luci.aurora",
  method: "check_updates",
  params: ["force_refresh"],
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

  ui.showModal(_(`Update package <em>%h</em>`).format(displayName), [
    E("p", {}, _(`Update to version <strong>%h</strong>?`).format(version)),
    E("div", { class: "right" }, [
      E(
        "div",
        {
          class: "btn",
          click: ui.hideModal,
        },
        _("Cancel")
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
        _("Update")
      ),
    ]),
  ]);
};

const executeUpdate = (packageName, repo, version, packageFilter) => {
  const dlg = ui.showModal(_("Installing Update"), [
    E("p", { class: "spinning" }, _("Downloading package...")),
  ]);

  callDownloadPackage(repo, version, packageFilter || "")
    .then((downloadResult) => {
      if (!downloadResult || downloadResult.result !== 0) {
        throw new Error(downloadResult?.error || "Download failed");
      }

      dlg.removeChild(dlg.lastChild);
      dlg.appendChild(
        E("p", { class: "spinning" }, _("Installing packages..."))
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
                  message: "Installation may have completed (timeout)",
                };
              }
              throw err;
            })
        );
      });

      return installPromise.then(() => outputs);
    })
    .then((outputs) => {
      dlg.removeChild(dlg.lastChild);

      if (outputs && outputs.length > 0) {
        dlg.appendChild(E("h5", {}, _("Installation Output")));
        outputs.forEach((output) => {
          if (output) {
            dlg.appendChild(E("pre", {}, output));
          }
        });
      }

      dlg.appendChild(
        E("p", {}, _("Installation completed! The page will reload to verify the update."))
      );
      dlg.appendChild(
        E("div", { class: "right" }, [
          E(
            "div",
            {
              class: "btn cbi-button-positive",
              click: () => {
                ui.hideModal();
                window.location.reload();
              },
            },
            _("Reload")
          ),
        ])
      );
    })
    .catch((err) => {
      dlg.removeChild(dlg.lastChild);
      dlg.appendChild(
        E(
          "p",
          { class: "alert-message error" },
          _(`Installation failed: %s`).format(err.message || err)
        )
      );
      dlg.appendChild(
        E("div", { class: "right" }, [
          E(
            "div",
            {
              class: "btn",
              click: ui.hideModal,
            },
            _("Close")
          ),
        ])
      );
    });
};

const createUpdateButton = (
  pkg,
  latest,
  updateInfo,
  displayName,
  installedVersion,
  packageFilter,
  i18nUpdateMap
) => {
  let hasUpdate = false;

  if (updateInfo && updateInfo[pkg.key]) {
    if (packageFilter) {
      hasUpdate = i18nUpdateMap && i18nUpdateMap[packageFilter] === "1";
    } else {
      hasUpdate = updateInfo[pkg.key].update_available;
    }

    if (hasUpdate) {
      const btnAttrs = {
        class: "btn cbi-button-positive",
        "data-package": pkg.key,
        "data-repo": pkg.name,
        "data-version": latest,
        "data-display-name": displayName,
        click: handleUpdate,
      };
      if (packageFilter) {
        btnAttrs["data-package-filter"] = packageFilter;
      }
      return E("div", btnAttrs, _("Update"));
    } else {
      return E("span", { class: "label success" }, _("Up to date"));
    }
  } else {
    return E("span", { class: "label info" }, _("Checking..."));
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
    const i18nPackages = versionData.i18n[pkg.key] || "";
    let latest = _("Checking...");
    const i18nUpdateMap = {};

    if (updateInfo && updateInfo[pkg.key]) {
      latest = updateInfo[pkg.key].latest_version || _("Unknown");

      const i18nUpdates = updateInfo[pkg.key].i18n_updates || "";
      if (i18nUpdates) {
        i18nUpdates.split(",").forEach((item) => {
          const parts = item.split(":");
          if (parts.length === 2) {
            i18nUpdateMap[parts[0]] = parts[1];
          }
        });
      }
    }

    rows.push([
      pkg.display,
      installed,
      latest,
      createUpdateButton(
        pkg,
        latest,
        updateInfo,
        pkg.display,
        installed,
        null,
        i18nUpdateMap
      ),
    ]);

    if (i18nPackages) {
      i18nPackages.split(",").forEach((item) => {
        const parts = item.split(":");
        const i18nName = parts[0];
        const i18nVersion = parts[1] || installed;

        rows.push([
          i18nName,
          i18nVersion,
          latest,
          createUpdateButton(
            pkg,
            latest,
            updateInfo,
            i18nName,
            i18nVersion,
            i18nName,
            i18nUpdateMap
          ),
        ]);
      });
    }
  });

  cbi_update_table(
    "#version-table",
    rows,
    E("em", {}, _("No version information available"))
  );
};

const checkForUpdates = (forceRefresh) => {
  const btn = document.querySelector('button[data-action="check-updates"]');
  if (btn) {
    btn.disabled = true;
    btn.classList.add("spinning");
  }

  updateVersionTable(null);

  callCheckUpdates(forceRefresh ? 1 : 0)
    .then((updateData) => {
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
          _(`Failed to check for updates: %s`).format(err.message || err)
        ),
        "error"
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

        E(
          "div",
          { class: "cbi-map-descr" },
          _("Manage Aurora theme and configuration package versions.")
        ),

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
            _("Check for Updates")
          ),
        ]),

        E("table", { id: "version-table", class: "table" }, [
          E("tr", { class: "tr cbi-section-table-titles" }, [
            E("th", { class: "th col-3 left" }, _("Package")),
            E("th", { class: "th col-3 left" }, _("Installed Version")),
            E("th", { class: "th col-3 left" }, _("Latest Version")),
            E(
              "th",
              { class: "th col-3 center cbi-section-actions" },
              _("Status")
            ),
          ]),
        ]),
      ]
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
