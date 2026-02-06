"use strict";
"require view";
"require form";
"require uci";
"require rpc";
"require ui";
"require fs";

const CACHE_KEY = "aurora.version.cache";
const CACHE_TTL = 1800000;
const CONFIG_IMPORT_PATH = "/tmp/aurora_config_import.tmp";

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

document.querySelector("head").appendChild(
  E("script", {
    type: "text/javascript",
    src: L.resource("view/aurora/color.global.js"),
  }),
);

const callUploadIcon = rpc.declare({
  object: "luci.aurora",
  method: "upload_icon",
  params: ["filename"],
});

const callListIcons = rpc.declare({
  object: "luci.aurora",
  method: "list_icons",
});

const callRemoveIcon = rpc.declare({
  object: "luci.aurora",
  method: "remove_icon",
  params: ["filename"],
});

const callCheckUpdates = rpc.declare({
  object: "luci.aurora",
  method: "check_updates",
});

const callGetInstalledVersions = rpc.declare({
  object: "luci.aurora",
  method: "get_installed_versions",
});

const callGetThemeConfig = rpc.declare({
  object: "luci.aurora",
  method: "get_theme_config",
});

const callGetThemePresets = rpc.declare({
  object: "luci.aurora",
  method: "get_theme_presets",
});

const callApplyThemePreset = rpc.declare({
  object: "luci.aurora",
  method: "apply_theme_preset",
  params: ["name"],
});

const callExportConfig = rpc.declare({
  object: "luci.aurora",
  method: "export_config",
});

const callImportConfig = rpc.declare({
  object: "luci.aurora",
  method: "import_config",
});

const callResetDefaults = rpc.declare({
  object: "luci.aurora",
  method: "reset_defaults",
});

const resolveCssColor = (() => {
  let resolverEl = null;

  return (value) => {
    if (!value || typeof value !== "string") return null;
    if (!document || !document.documentElement) return null;

    if (!resolverEl) {
      resolverEl = document.createElement("span");
      resolverEl.style.cssText =
        "position:absolute;left:-9999px;top:-9999px;visibility:hidden;pointer-events:none;";
      (document.body || document.documentElement).appendChild(resolverEl);
    }

    resolverEl.style.color = "";
    resolverEl.style.color = value;
    if (!resolverEl.style.color) return null;

    const computed = getComputedStyle(resolverEl).color;
    return computed || null;
  };
})();

const renderColorPicker = function (option_index, section_id, in_table) {
  const el = form.Value.prototype.render.apply(this, [
    option_index,
    section_id,
    in_table,
  ]);
  return Promise.resolve(el).then((element) => {
    const input = element.querySelector('input[type="text"]');
    if (input) {
      let colorHex = null;
      const resolved = resolveCssColor(input.value);
      try {
        const color = new Color(resolved || input.value);
        if (color.alpha < 1) color.alpha = 1;
        colorHex = color.toString({ format: "hex" });
      } catch (e) {
        return element;
      }

      const colorInput = E("input", {
        type: "color",
        value: colorHex,
        style:
          "margin-left: 8px; height: 2em; width: 3em; vertical-align: middle; cursor: pointer;",
        title: _("Click to select color visually"),
        change: () => (input.value = colorInput.value),
      });
      input.parentNode.appendChild(colorInput);
    }
    return element;
  });
};

const addColorInputs = (ss, mode, colorVars, defaults) => {
  colorVars.forEach(([key, label]) => {
    const optionKey = `${mode}_${key}`;
    const defaultValue = defaults?.[optionKey];
    const so = ss.option(form.Value, optionKey, label);
    if (defaultValue !== undefined) {
      so.default = defaultValue;
      so.placeholder = defaultValue;
    }
    so.rmempty = false;
    so.render = renderColorPicker;
  });
};

const createColorSection = (
  ss,
  tab,
  id,
  title,
  description,
  colorVars,
  mode,
  defaults,
) => {
  const o = ss.taboption(
    tab,
    form.SectionValue,
    id,
    form.NamedSection,
    "theme",
    "aurora",
    title,
    description,
  );
  addColorInputs(o.subsection, mode, colorVars, defaults);
};

const createColorSections = (ss, mode, colorGroups, defaults) => {
  colorGroups.forEach(({ key, title, description, vars }) => {
    const id = `_${mode}_${key}`;
    createColorSection(ss, mode, id, title, description, vars, mode, defaults);
  });
};

const createRangeControlRenderer = (config) => {
  return function (option_index, section_id, in_table) {
    const self = this;
    const el = form.Value.prototype.render.apply(this, [
      option_index,
      section_id,
      in_table,
    ]);
    return Promise.resolve(el).then((element) => {
      const input = element.querySelector("input");
      if (input) {
        input.type = "hidden";
        const numValue =
          parseFloat(input.value || self.default) || config.default;

        const valueDisplay = E(
          "span",
          {
            style: `margin-left: 10px; min-width: ${config.displayWidth}px; display: inline-block;`,
          },
          `${numValue.toFixed(config.precision)}rem`,
        );

        const getMaxValue = () => {
          if (typeof config.max === "function") {
            return config.max().toString();
          }
          return config.max.toString();
        };

        const maxValue = getMaxValue();

        const rangeInput = E("input", {
          type: "range",
          min: config.min.toString(),
          max: maxValue,
          step: config.step.toString(),
          value: numValue,
          style: "width: 200px; vertical-align: middle;",
          input: function () {
            const val = `${parseFloat(this.value).toFixed(config.precision)}rem`;
            input.value = val;
            valueDisplay.textContent = val;
          },
        });

        if (typeof config.max === "function") {
          const handleResize = () => {
            const newMaxWidth = config.max();
            rangeInput.max = newMaxWidth.toString();
            if (parseFloat(rangeInput.value) > newMaxWidth) {
              rangeInput.value = newMaxWidth;
              const val = `${newMaxWidth.toFixed(config.precision)}rem`;
              input.value = val;
              valueDisplay.textContent = val;
            }
          };

          window.addEventListener("resize", handleResize);
        }

        input.parentNode.appendChild(rangeInput);
        input.parentNode.appendChild(valueDisplay);
      }
      return element;
    });
  };
};

const renderSpacingControl = createRangeControlRenderer({
  min: "-0.1",
  max: "0.5",
  step: "0.05",
  default: 0.25,
  precision: 2,
  displayWidth: 60,
});

const renderContainerMaxWidthControl = createRangeControlRenderer({
  min: "72",
  max: () => {
    const getRootFontSize = () => {
      return parseFloat(
        window.getComputedStyle(document.documentElement).fontSize,
      );
    };

    const screenWidth = window.innerWidth;
    const maxWidthPx = screenWidth * (23 / 24);
    const rootFontSize = getRootFontSize();
    const maxWidthRem = Math.floor((maxWidthPx / rootFontSize) * 10) / 10;
    return Math.max(maxWidthRem, 80);
  },
  step: "1",
  default: 80,
  precision: 1,
  displayWidth: 80,
});

const createIconUploadButton = (ss, tmpPath) => {
  const so = ss.option(form.Button, "_upload_icon", _("Upload Icon"));
  so.inputstyle = "add";
  so.inputtitle = _("Click me to upload");
  so.onclick = ui.createHandlerFn(this, () => {
    return ui
      .uploadFile(tmpPath, event.target)
      .then((res) => {
        if (!res?.name) throw new Error(_("No file selected or upload failed"));
        const filename = res.name.split("/").pop().split("\\").pop();
        return L.resolveDefault(callUploadIcon(filename), {})
          .then((ret) => {
            if (ret?.result === 0) {
              window.location.reload();
              ui.addNotification(
                null,
                E("p", _("Icon uploaded successfully: %s").format(filename)),
              );
            } else {
              const errorMsg = ret?.error || "Unknown error";
              ui.addNotification(
                null,
                E("p", _("Failed to upload icon: %s").format(errorMsg)),
              );
              return L.resolveDefault(fs.remove(tmpPath), {});
            }
          })
          .catch((err) => {
            ui.addNotification(
              null,
              E("p", _("RPC call failed: %s").format(err.message || err)),
            );
            return L.resolveDefault(fs.remove(tmpPath), {});
          });
      })
      .catch((e) => {
        ui.addNotification(
          null,
          E("p", _("Upload error: %s").format(e.message)),
        );
        return L.resolveDefault(fs.remove(tmpPath), {});
      });
  });
};

const createIconList = (ss) => {
  const so = ss.option(form.DummyValue, "_icon_list", _("Uploaded Icons"));
  so.load = () => L.resolveDefault(callListIcons(), { icons: [] });
  so.cfgvalue = (section_id, data) => data?.icons || [];
  so.render = function (option_index, section_id, in_table) {
    return this.load(section_id).then((data) => {
      const icons = this.cfgvalue(section_id, data);

      const container = E("div", { class: "cbi-value-field" });

      if (icons.length === 0) {
        container.appendChild(E("em", {}, _("No icons uploaded yet.")));
        return E("div", { class: "cbi-value", "data-name": this.option }, [
          E("label", { class: "cbi-value-title" }, this.title),
          container,
        ]);
      }

      const table = E("table", { class: "table" }, [
        E("tr", { class: "tr table-titles" }, [
          E("th", { class: "th" }, _("Icon Name")),
          E("th", { class: "th center" }, _("Actions")),
        ]),
      ]);

      icons.forEach((icon) => {
        const deleteBtn = E(
          "button",
          {
            class: "cbi-button cbi-button-remove",
            click: ui.createHandlerFn(this, () => {
              return ui.showModal(_("Delete Icon"), [
                E("p", {}, _("Delete icon '%s'?").format(icon)),
                E("div", { class: "right" }, [
                  E(
                    "button",
                    { class: "btn", click: ui.hideModal },
                    _("Cancel"),
                  ),
                  " ",
                  E(
                    "button",
                    {
                      class: "btn cbi-button-negative",
                      click: () => {
                        ui.showModal(_("Deleting..."), [
                          E("p", { class: "spinning" }, _("Deleting icon...")),
                        ]);
                        L.resolveDefault(callRemoveIcon(icon), {}).then(
                          (ret) => {
                            if (ret.result === 0) {
                              ui.hideModal();
                              ui.addNotification(
                                null,
                                E("p", _("Icon deleted: %s").format(icon)),
                              );
                              window.location.reload();
                            } else {
                              ui.hideModal();
                              ui.addNotification(
                                null,
                                E(
                                  "p",
                                  _("Failed to delete icon: %s").format(icon),
                                ),
                                "error",
                              );
                            }
                          },
                        );
                      },
                    },
                    _("Delete"),
                  ),
                ]),
              ]);
            }),
          },
          _("Delete"),
        );

        table.appendChild(
          E("tr", { class: "tr" }, [
            E("td", { class: "td", style: "font-family: monospace;" }, icon),
            E("td", { class: "td center" }, deleteBtn),
          ]),
        );
      });

      container.appendChild(table);

      return E("div", { class: "cbi-value", "data-name": this.option }, [
        E("label", { class: "cbi-value-title" }, this.title),
        container,
      ]);
    });
  };
};

return view.extend({
  load: function () {
    return Promise.all([
      uci.load("aurora"),
      L.resolveDefault(callGetThemeConfig(), {}),
      L.resolveDefault(callGetThemePresets(), {}),
      L.resolveDefault(callGetInstalledVersions(), {}),
    ]);
  },

  render(loadData) {
    const themeConfig = loadData[1]?.theme || {};
    const themePresets = loadData[2]?.presets || [];
    const installedVersions = loadData[3];

    // Order matches luci-theme-aurora/.dev/src/media/main.css @theme inline
    const baseColorVars = [
      ["background", _("Background")],
      ["foreground", _("Foreground")],
      ["page_bg", _("Page Background")],
      ["panel_bg", _("Panel Background")],
      ["primary", _("Primary")],
      ["primary_foreground", _("Primary Foreground")],
      ["border", _("Border")],
    ];

    const componentColorVars = [
      ["header_bg", _("Header Background")],
      ["header_interactive", _("Header Interactive")],
      ["progress_bar_start", _("Progress Bar Start")],
      ["progress_bar_end", _("Progress Bar End")],
      ["terminal_bg", _("Terminal Background")],
      ["terminal_foreground", _("Terminal Foreground")],
      ["tooltip_bg", _("Tooltip Background")],
      ["overlay_base", _("Overlay Base")],
      ["link", _("Link")],
      ["input_checked", _("Input Checked")],
      ["label_surface", _("Label Surface")],
    ];

    const semanticStatusColorVars = [
      ["secondary", _("Secondary")],
      ["secondary_foreground", _("Secondary Foreground")],
      ["destructive", _("Destructive")],
      ["destructive_foreground", _("Destructive Foreground")],
      ["accent", _("Accent")],
      ["accent_foreground", _("Accent Foreground")],
      ["muted", _("Muted")],
      ["muted_foreground", _("Muted Foreground")],
      ["default", _("Default")],
      ["default_foreground", _("Default Foreground")],
      ["info", _("Info")],
      ["info_foreground", _("Info Foreground")],
      ["warning", _("Warning")],
      ["warning_foreground", _("Warning Foreground")],
      ["success", _("Success")],
      ["success_foreground", _("Success Foreground")],
      ["error", _("Error")],
      ["error_foreground", _("Error Foreground")],
    ];

    const colorGroups = [
      {
        key: "base",
        title: _("Base Colors"),
        description: _(
          "The theme layout uses three layers: background (Background) → page container (Page) → panel card (Panel). These variables define each layer's background color (Background) and foreground/text color (Foreground). The primary color (Primary) is mainly used for focused/active states of inputs, selects, radios, checkboxes, and dropdowns, and is also used for key buttons and the page footer.",
        ),
        vars: baseColorVars,
      },
      {
        key: "component",
        title: _("Component Colors"),
        description: _(
          "Controls colors used by specific UI components: top navigation bar (Header) and boxed dropdown hover background (Header Interactive), progress bar gradient (Progress Bar Start/End), log panel (Terminal), overlay mask (Overlay), links (Link), checked radios/checkboxes (Input Checked), tooltip bubble (Tooltip), and section header surfaces (Label Surface).",
        ),
        vars: componentColorVars,
      },
      {
        key: "semantic_status",
        title: _("Semantic & Status Colors"),
        description: _(
          "Semantic colors represent different actions and intents, commonly used in buttons and badges. For example, destructive (Destructive) maps to high‑risk actions like delete or reset. Status colors represent system feedback states, commonly used in tooltip messages (Tooltip), alert dialogs (Alert), status tags (Tag), and legends (Legend). Each status type (Default, Info, Warning, Success, Error) has two colors: a background color and a foreground/text color (Foreground).",
        ),
        vars: semanticStatusColorVars,
      },
    ];

    const m = new form.Map("aurora", _("Aurora Theme Settings"));

    const themeVersion =
      installedVersions?.theme?.installed_version || "Unknown";
    const configVersion =
      installedVersions?.config?.installed_version || "Unknown";

    let so;
    const viewCtx = this;

    const buildPresetOptions = () => {
      if (themePresets.length > 0) {
        const options = themePresets
          .filter((preset) => preset?.name)
          .map((preset) => ({
            name: preset.name,
            label: preset.label || preset.name,
          }));
        if (options.length > 0) return options;
      }
      return [
        { name: "classic", label: _("Classic") },
        { name: "monochrome", label: _("Monochrome") },
        { name: "sage-green", label: _("Sage Green") },
        { name: "amber-sand", label: _("Amber Sand") },
        { name: "sky-blue", label: _("Sky Blue") },
      ];
    };

    const buildPresetToolbarNode = () => {
      const presetOptions = buildPresetOptions();
      const defaultPreset = "classic";
      const storedPreset = localStorage.getItem("aurora.theme_preset");
      const hasStoredPreset = presetOptions.some(
        (preset) => preset.name === storedPreset,
      );
      const initialPreset = hasStoredPreset ? storedPreset : defaultPreset;

      if (!hasStoredPreset) {
        localStorage.setItem("aurora.theme_preset", initialPreset);
      }

      const select = E(
        "select",
        {
          class: "cbi-input-select",
        },
        presetOptions.map((preset) =>
          E(
            "option",
            {
              value: preset.name,
              selected: preset.name === initialPreset ? "selected" : null,
            },
            preset.label,
          ),
        ),
      );

      select.addEventListener("change", () => {
        localStorage.setItem("aurora.theme_preset", select.value);
      });

      const resolvePresetSelection = () => {
        const stored = localStorage.getItem("aurora.theme_preset");
        const storedPreset = presetOptions.find(
          (preset) => preset.name === stored,
        );
        if (storedPreset && select.value !== stored) {
          select.value = stored;
        }
        const presetName =
          (storedPreset && stored) || select?.value || defaultPreset;
        const presetLabel =
          select?.selectedOptions?.[0]?.textContent || presetName;
        return { presetName, presetLabel };
      };

      const applyButton = E(
        "button",
        {
          class: "cbi-button cbi-button-apply",
          title: _("Apply Preset"),
          click: ui.createHandlerFn(viewCtx, () => {
            const { presetName, presetLabel } = resolvePresetSelection();

            return ui.showModal(_("Apply Theme Preset"), [
              E(
                "p",
                {},
                _(
                  "Apply preset '%s'? This will switch the full theme style to the '%s' preset and overwrite the theme configuration file at /etc/config/aurora.",
                ).format(presetLabel, presetLabel),
              ),
              E("div", { class: "right" }, [
                E("button", { class: "btn", click: ui.hideModal }, _("Cancel")),
                " ",
                E(
                  "button",
                  {
                    class: "btn cbi-button-action important",
                    click: () => {
                      ui.showModal(_("Applying..."), [
                        E("p", { class: "spinning" }, _("Updating theme...")),
                      ]);
                      return L.resolveDefault(
                        callApplyThemePreset(presetName),
                        {},
                      ).then((ret) => {
                        ui.hideModal();
                        if (ret?.result === 0) {
                          ui.addNotification(
                            null,
                            E("p", _("Preset applied successfully.")),
                            "info",
                          );
                          window.location.reload();
                        } else {
                          ui.addNotification(
                            null,
                            E(
                              "p",
                              _("Apply failed: %s").format(
                                ret?.error || "Unknown",
                              ),
                            ),
                            "error",
                          );
                        }
                      });
                    },
                  },
                  _("Apply"),
                ),
              ]),
            ]);
          }),
        },
        _("Apply"),
      );

      const exportButton = E(
        "button",
        {
          class: "cbi-button cbi-button-apply",
          title: _("Export Configuration"),
          click: ui.createHandlerFn(viewCtx, () => {
            return L.resolveDefault(callExportConfig(), null)
              .then((res) => {
                if (!res || res.result !== 0) {
                  throw new Error(res?.error || _("Export failed"));
                }

                const form = E(
                  "form",
                  {
                    method: "post",
                    action: L.env.cgi_base + "/cgi-download",
                    enctype: "application/x-www-form-urlencoded",
                  },
                  [
                    E("input", {
                      type: "hidden",
                      name: "sessionid",
                      value: rpc.getSessionID(),
                    }),
                    E("input", {
                      type: "hidden",
                      name: "path",
                      value: res.path,
                    }),
                    E("input", {
                      type: "hidden",
                      name: "filename",
                      value: res.filename || "aurora",
                    }),
                  ],
                );

                document.body.appendChild(form);
                form.submit();
                form.parentNode.removeChild(form);

                ui.addNotification(
                  null,
                  E("p", _("Configuration exported successfully.")),
                  "info",
                );
              })
              .catch((err) => {
                ui.addNotification(
                  null,
                  E("p", _("Export failed: %s").format(err.message || err)),
                  "error",
                );
              });
          }),
        },
        _("Export"),
      );

      const importButton = E(
        "button",
        {
          class: "cbi-button cbi-button-add",
          title: _("Import Configuration"),
          click: ui.createHandlerFn(viewCtx, function (ev) {
            const btn = ev.currentTarget || ev.target;
            const originalLabel = btn?.firstChild?.data;

            return ui
              .uploadFile(CONFIG_IMPORT_PATH, btn)
              .then(
                L.bind(function (res) {
                  if (!res?.name)
                    throw new Error(_("No file selected or upload failed"));
                  if (btn?.firstChild)
                    btn.firstChild.data = _("Checking file…");
                  return fs.read(CONFIG_IMPORT_PATH);
                }, this),
              )
              .then(
                L.bind(function (content) {
                  const preview = content || "";

                  ui.showModal(_("Apply configuration?"), [
                    E(
                      "p",
                      {},
                      _(
                        "Please upload the Aurora configuration file named 'aurora'. This will overwrite the theme configuration at /etc/config/aurora. Press 'Continue' to apply and reload, or 'Cancel' to abort.",
                      ),
                    ),
                    E("pre", {}, preview),
                    E("div", { class: "right" }, [
                      E(
                        "button",
                        {
                          class: "btn",
                          click: ui.createHandlerFn(this, () =>
                            fs.remove(CONFIG_IMPORT_PATH).finally(ui.hideModal),
                          ),
                        },
                        _("Cancel"),
                      ),
                      " ",
                      E(
                        "button",
                        {
                          class: "btn cbi-button-action important",
                          click: ui.createHandlerFn(this, () => {
                            ui.showModal(_("Importing..."), [
                              E("p", { class: "spinning" }, _("Applying...")),
                            ]);
                            return L.resolveDefault(
                              callImportConfig(),
                              {},
                            ).then((ret) => {
                              ui.hideModal();
                              if (ret?.result === 0) {
                                ui.addNotification(
                                  null,
                                  E(
                                    "p",
                                    _("Configuration imported successfully."),
                                  ),
                                  "info",
                                );
                                window.location.reload();
                              } else {
                                const errorMsg = ret?.error || "Unknown error";
                                ui.addNotification(
                                  null,
                                  E(
                                    "p",
                                    _("Import failed: %s").format(errorMsg),
                                  ),
                                  "error",
                                );
                              }
                            });
                          }),
                        },
                        _("Continue"),
                      ),
                    ]),
                  ]);
                }, this),
              )
              .catch((err) => {
                ui.addNotification(
                  null,
                  E("p", _("Import failed: %s").format(err.message || err)),
                  "error",
                );
                return L.resolveDefault(fs.remove(CONFIG_IMPORT_PATH), {});
              })
              .finally(() => {
                if (btn?.firstChild && originalLabel !== undefined)
                  btn.firstChild.data = originalLabel;
              });
          }),
        },
        _("Import"),
      );

      const resetButton = E(
        "button",
        {
          class: "cbi-button cbi-button-reset",
          title: _("Reset to Defaults"),
          click: ui.createHandlerFn(viewCtx, () => {
            return ui.showModal(_("Reset to Defaults"), [
              E(
                "p",
                {},
                _(
                  "Are you sure you want to reset all theme settings (Color, Structure, Icons & Toolbar) back to the default theme's original configuration? This will revert everything to the default theme's initial state.",
                ),
              ),
              E("div", { class: "right" }, [
                E("button", { class: "btn", click: ui.hideModal }, _("Cancel")),
                " ",
                E(
                  "button",
                  {
                    class: "btn cbi-button-negative",
                    click: () => {
                      ui.showModal(_("Resetting..."), [
                        E("p", { class: "spinning" }, _("Restoring...")),
                      ]);
                      return L.resolveDefault(callResetDefaults(), {}).then(
                        (ret) => {
                          ui.hideModal();
                          if (ret?.result === 0) {
                            window.location.reload();
                            ui.addNotification(
                              null,
                              E("p", _("Settings reset successfully.")),
                              "info",
                            );
                          } else {
                            ui.addNotification(
                              null,
                              E(
                                "p",
                                _("Error: %s").format(ret?.error || "Unknown"),
                              ),
                              "error",
                            );
                          }
                        },
                      );
                    },
                  },
                  _("Confirm Reset"),
                ),
              ]),
            ]);
          }),
        },
        _("Reset"),
      );

      const presetGroup = E(
        "div",
        {
          style: "display:flex; flex-wrap:wrap; gap:0.5em; align-items:center;",
        },
        [
          E(
            "span",
            { style: "font-weight: 600; white-space: nowrap;" },
            _("Preset"),
          ),
          select,
          applyButton,
        ],
      );

      const actionGroup = E(
        "div",
        {
          style: "display:flex; flex-wrap:wrap; gap:0.5em; align-items:center;",
        },
        [exportButton, importButton, resetButton],
      );

      return E(
        "div",
        {
          class: "aurora-preset-toolbar",
          style:
            "display:flex; flex-wrap:wrap; gap:0.75em 1em; align-items:center;",
        },
        [presetGroup, actionGroup],
      );
    };

    const headerBar = E(
      "div",
      {
        style:
          "display: flex; flex-wrap: wrap; gap: 1em; align-items: center; justify-content: space-between;",
      },
      [
        E("div", { style: "display: flex; flex-wrap: wrap; gap: 1em;" }, [
          E("span", { style: "white-space: nowrap;" }, [
            document.createTextNode(_("Theme: ")),
            E(
              "span",
              {
                id: "theme-version",
                class: "label success",
                style: "cursor: pointer;",
              },
              `v${themeVersion}`,
            ),
          ]),
          E("span", { style: "white-space: nowrap;" }, [
            document.createTextNode(_("Config: ")),
            E(
              "span",
              {
                id: "config-version",
                class: "label success",
                style: "cursor: pointer;",
              },
              `v${configVersion}`,
            ),
          ]),
        ]),
        buildPresetToolbarNode(),
      ],
    );

    m.description = headerBar;

    const s = m.section(form.NamedSection, "theme", "aurora");

    s.tab("colors", _("Color"));
    s.tab("structure", _("Structure"));
    s.tab("icons_toolbar", _("Icons & Toolbar"));

    const colorSection = s.taboption(
      "colors",
      form.SectionValue,
      "_colors",
      form.NamedSection,
      "theme",
      "aurora",
    );
    const colorSubsection = colorSection.subsection;
    colorSubsection.tab("light", _("Light Mode"));
    colorSubsection.tab("dark", _("Dark Mode"));

    createColorSections(colorSubsection, "light", colorGroups, themeConfig);
    createColorSections(colorSubsection, "dark", colorGroups, themeConfig);

    const structureSection = s.taboption(
      "structure",
      form.SectionValue,
      "_structure_layout",
      form.NamedSection,
      "theme",
      "aurora",
      _("Layout"),
      _(
        "Customize the layout of your interface. Control how the navigation menu displays, adjust the spacing between interface elements, and set the maximum width of the main content container.",
      ),
    );
    const structureSubsection = structureSection.subsection;

    so = structureSubsection.option(
      form.ListValue,
      "nav_submenu_type",
      _("Navigation Submenu Type"),
    );
    so.value("mega-menu", _("Mega Menu"));
    so.value("boxed-dropdown", _("Boxed Dropdown"));
    so.default = "mega-menu";
    so.rmempty = false;

    so = structureSubsection.option(
      form.Value,
      "struct_spacing",
      _("Element Spacing"),
    );
    so.default = "0.25rem";
    so.placeholder = "0.25rem";
    so.rmempty = false;
    so.render = renderSpacingControl;

    so = structureSubsection.option(
      form.Value,
      "struct_container_max_width",
      _("Content Container Max Width"),
    );
    so.default = "80rem";
    so.placeholder = "80rem";
    so.rmempty = false;
    so.render = renderContainerMaxWidthControl;

    const iconSection = s.taboption(
      "icons_toolbar",
      form.SectionValue,
      "_icon_management",
      form.NamedSection,
      "theme",
      "aurora",
      _("Icon Management"),
      _(
        "Upload theme branding assets (browser tab favicon) and custom toolbar icons. Supported formats include SVG, PNG, JPG, and more. Uploaded assets are stored in<code>/www/luci-static/aurora/images/</code> and can be used throughout the theme.",
      ),
    );
    const iconSubsection = iconSection.subsection;
    createIconUploadButton(iconSubsection, "/tmp/aurora_icon.tmp");
    createIconList(iconSubsection);

    const logoSection = s.taboption(
      "icons_toolbar",
      form.SectionValue,
      "_logo_settings",
      form.NamedSection,
      "theme",
      "aurora",
      _("Logo Settings"),
      _(
        "Select custom logos for your browser tab icon (favicon). For best compatibility, upload both SVG and PNG formats. Modern browsers will use the SVG version, while older browsers will fall back to the 32x32 PNG version.",
      ),
    );
    const logoSubsection = logoSection.subsection;

    so = logoSubsection.option(form.ListValue, "logo_svg", _("SVG Logo"));
    so.default = "logo.svg";
    so.rmempty = false;
    so.load = function (section_id) {
      return L.resolveDefault(callListIcons(), { icons: [] }).then(
        L.bind((response) => {
          const icons = response?.icons || [];
          this.keylist = [];
          this.vallist = [];
          if (icons.length > 0) {
            icons.forEach(
              L.bind((icon) => {
                if (icon.endsWith(".svg")) {
                  this.value(icon, icon);
                }
              }, this),
            );
          }
          return form.ListValue.prototype.load.apply(this, [section_id]);
        }, this),
      );
    };

    so = logoSubsection.option(
      form.ListValue,
      "logo_png",
      _("PNG Logo (32x32)"),
    );
    so.default = "logo_32.png";
    so.rmempty = false;
    so.load = function (section_id) {
      return L.resolveDefault(callListIcons(), { icons: [] }).then(
        L.bind((response) => {
          const icons = response?.icons || [];
          this.keylist = [];
          this.vallist = [];
          if (icons.length > 0) {
            icons.forEach(
              L.bind((icon) => {
                if (icon.endsWith(".png")) {
                  this.value(icon, icon);
                }
              }, this),
            );
          }
          return form.ListValue.prototype.load.apply(this, [section_id]);
        }, this),
      );
    };

    const toolbarSection = s.taboption(
      "icons_toolbar",
      form.SectionValue,
      "_toolbar_settings",
      form.NamedSection,
      "theme",
      "aurora",
      _("Floating Toolbar"),
    );
    const toolbarSubsection = toolbarSection.subsection;

    so = toolbarSubsection.option(
      form.Flag,
      "toolbar_enabled",
      _("Enable Floating Toolbar"),
    );
    so.description = _(
      "Enable or disable the floating toolbar on the right side of the screen.",
    );
    so.default = "1";
    so.rmempty = false;

    so = toolbarSubsection.option(
      form.SectionValue,
      "_toolbar_items",
      form.GridSection,
      "toolbar_item",
      _("Toolbar Buttons"),
      _(
        "Customize toolbar buttons by adding new entries, editing existing ones, removing unwanted items, or dragging rows to reorder them.",
      ),
    );
    so.depends("toolbar_enabled", "1");
    const toolbarGrid = so.subsection;
    toolbarGrid.addremove = true;
    toolbarGrid.sortable = true;
    toolbarGrid.anonymous = true;
    toolbarGrid.nodescriptions = true;

    so = toolbarGrid.option(form.Flag, "enabled", _("Enabled"));
    so.default = "1";
    so.rmempty = false;
    so.editable = true;

    so = toolbarGrid.option(form.Value, "title", _("Button Title"));
    so.rmempty = false;
    so.placeholder = _("e.g., System Settings");
    so.validate = (section_id, value) =>
      !value?.trim() ? _("Button title cannot be empty") : true;

    so = toolbarGrid.option(form.Value, "url", _("Target URL"));
    so.rmempty = false;
    so.placeholder = "/cgi-bin/luci/admin/...";
    so.validate = (section_id, value) =>
      !value?.trim() ? _("URL cannot be empty") : true;

    so = toolbarGrid.option(form.ListValue, "icon", _("Icon"));
    so.rmempty = false;
    so.load = function (section_id) {
      return L.resolveDefault(callListIcons(), { icons: [] }).then(
        L.bind((response) => {
          const icons = response?.icons || [];
          this.keylist = [];
          this.vallist = [];
          if (icons.length > 0) {
            icons.forEach(L.bind((icon) => this.value(icon, icon), this));
          } else {
            this.value("", _("(No icons uploaded)"));
          }
          return form.ListValue.prototype.load.apply(this, [section_id]);
        }, this),
      );
    };
    so.validate = (section_id, value) =>
      !value?.trim() ? _("Please select an icon") : true;

    return m.render().then((mapNode) => {
      const updateVersionLabel = (label, hasUpdate) => {
        if (!label || !hasUpdate) return;

        label.className = "label warning";
        Object.assign(label.style, {
          position: "relative",
          paddingRight: "16px",
        });
        const redDot = document.createElement("span");
        redDot.style.cssText =
          "position: absolute; top: 3px; right: 4px; width: 6px; height: 6px; background: #f44; border-radius: 50%; animation: pulse 2s infinite;";
        label.appendChild(redDot);
      };

      requestAnimationFrame(() => {
        const labels = {
          theme: mapNode.querySelector("#theme-version"),
          config: mapNode.querySelector("#config-version"),
        };

        Object.values(labels).forEach((label) => {
          if (label)
            label.onclick = () =>
              (window.location.href = L.url("admin/system/aurora/version"));
        });

        const cached = versionCache.get();
        if (cached) {
          updateVersionLabel(labels.theme, cached?.theme?.update_available);
          updateVersionLabel(labels.config, cached?.config?.update_available);
        } else {
          L.resolveDefault(callCheckUpdates(), null)
            .then((updateData) => {
              if (updateData) {
                versionCache.set(updateData);
                updateVersionLabel(
                  labels.theme,
                  updateData?.theme?.update_available,
                );
                updateVersionLabel(
                  labels.config,
                  updateData?.config?.update_available,
                );
              }
            })
            .catch((err) => console.error("Failed to check version:", err));
        }
      });

      return mapNode;
    });
  },
});
