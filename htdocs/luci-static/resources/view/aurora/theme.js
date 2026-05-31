"use strict";
"require view";
"require form";
"require uci";
"require rpc";
"require ui";
"require fs";
"require utils.version-api";

const CONFIG_IMPORT_PATH = "/tmp/aurora_config_import.tmp";

document.querySelector("head").appendChild(
  E("script", {
    type: "text/javascript",
    src: L.resource("utils/color.global.js"),
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

let _iconsPromise = null;
const getIconsOnce = () => {
  if (!_iconsPromise)
    _iconsPromise = L.resolveDefault(callListIcons(), { icons: [] });
  return _iconsPromise;
};

const callRemoveIcon = rpc.declare({
  object: "luci.aurora",
  method: "remove_icon",
  params: ["filename"],
});

const callGetThemeConfig = rpc.declare({
  object: "luci.aurora",
  method: "get_theme_config",
});

const callGetFontPresets = rpc.declare({
  object: "luci.aurora",
  method: "get_font_presets",
});

const callApplyThemePreset = rpc.declare({
  object: "luci.aurora",
  method: "apply_theme_preset",
  params: ["name"],
});

const callPrepareFont = rpc.declare({
  object: "luci.aurora",
  method: "prepare_font",
  params: ["sans", "mono"],
  expect: {
    "": { result: -1, error: "RPC call failed (timeout or transport error)" },
  },
});

const callGetFontStatus = rpc.declare({
  object: "luci.aurora",
  method: "get_font_status",
  params: ["job_id"],
  expect: { "": { state: "missing", error: "RPC call failed" } },
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

const callWritePwaManifest = rpc.declare({
  object: "luci.aurora",
  method: "write_pwa_manifest",
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

const renderRadiusControl = createRangeControlRenderer({
  min: "0",
  max: "1.5",
  step: "0.125",
  default: 0.5,
  precision: 3,
  displayWidth: 70,
});

const generateLqip = (source) =>
  new Promise((resolve) => {
    const img = new Image();
    const isBlob = source instanceof Blob;
    const url = isBlob ? URL.createObjectURL(source) : source;
    const cleanup = () => {
      if (isBlob) URL.revokeObjectURL(url);
    };

    img.onload = () => {
      const W = 32;
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = Math.round(img.naturalHeight * (W / img.naturalWidth));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      cleanup();
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(null);
            return;
          }
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result);
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(blob);
        },
        "image/webp",
        0.1,
      );
    };
    img.onerror = () => {
      cleanup();
      resolve(null);
    };
    img.src = url;
  });

const toLoginBgUrl = (filename) =>
  "url('/luci-static/aurora/images/" + filename + "')";

const fromLoginBgUrl = (value) => {
  if (!value || typeof value !== "string") return "";
  const match = value.match(/\/images\/([^')]+)/);
  return match ? match[1] : "";
};

const isImageFile = (filename) =>
  /\.(jpg|jpeg|png|gif|webp|avif|svg|bmp|ico)$/i.test(filename);

return view.extend({
  handleSave: function (ev) {
    const save = L.bind(function () {
      return this.super("handleSave", ev);
    }, this);
    const writePwa = () => L.resolveDefault(callWritePwaManifest(), {});

    if (typeof this.prepareAuroraFonts === "function") {
      return this.prepareAuroraFonts().then(save).then(writePwa);
    }
    return save().then(writePwa);
  },

  handleSaveApply: function (ev) {
    const saveApply = L.bind(function () {
      return this.super("handleSaveApply", ev);
    }, this);
    const writePwa = () => L.resolveDefault(callWritePwaManifest(), {});

    if (typeof this.prepareAuroraFonts === "function") {
      return this.prepareAuroraFonts().then(saveApply).then(writePwa);
    }
    return saveApply().then(writePwa);
  },

  load: function () {
    return Promise.all([
      uci.load("aurora"),
      L.resolveDefault(callGetThemeConfig(), {}),
      L.resolveDefault(utils_version_api.callGetInstalledVersions(), {}),
      L.resolveDefault(callGetFontPresets(), {}),
      getIconsOnce(),
    ]);
  },

  render(loadData) {
    const themeConfig = loadData[1]?.theme || {};
    const installedVersions = loadData[2];
    const fontPresetsBySlot = loadData[3]?.fonts || {};

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
          "The theme layout uses three layers: background (Background) → page container (Page) → panel card (Panel). The Base Colors variables define each layer's background color (Background) and foreground/text color (Foreground). The primary color (Primary) is mainly used for focused/active states of inputs, selects, radios, checkboxes, and dropdowns, and is also used for key buttons and the page footer.",
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

    const buildPresetOptions = () => [
      { name: "classic", label: _("Classic") },
      { name: "monochrome", label: _("Monochrome") },
      { name: "sage-green", label: _("Sage Green") },
      { name: "amber-sand", label: _("Amber Sand") },
      { name: "sky-blue", label: _("Sky Blue") },
    ];

    const FONT_DEFAULT_STACKS = {
      sans: '"Lato", ui-sans-serif, system-ui, sans-serif',
      mono: 'ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace',
    };

    const buildFontOptions = (slot) => {
      const list = fontPresetsBySlot?.[slot];
      if (Array.isArray(list) && list.length > 0) {
        const options = list
          .filter((font) => font?.name)
          .map((font) => ({
            name: font.name,
            label: font.label || font.name,
            source: font.source || "",
            family: font.family || "",
            stack: font.stack || "",
          }));
        if (options.length > 0) return options;
      }
      const fallbackStack = FONT_DEFAULT_STACKS[slot] || "";
      if (!fallbackStack) return [];
      return [
        {
          name: "default",
          label: slot === "sans" ? "Lato" : _("System Mono"),
          source: _("Built-in"),
          stack: fallbackStack,
        },
      ];
    };

    const buildPresetToolbarNode = () => {
      const presetOptions = buildPresetOptions();
      const uciPreset = themeConfig.active_preset;
      const storedPreset = localStorage.getItem("aurora.theme_preset");
      const initialPreset = presetOptions.some((p) => p.name === uciPreset)
        ? uciPreset
        : presetOptions.some((p) => p.name === storedPreset)
          ? storedPreset
          : "classic";

      localStorage.setItem("aurora.theme_preset", initialPreset);

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
                  "This will switch the theme style to the '%s' preset and overwrite the configuration in /etc/config/aurora. Do you want to continue?",
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
                  "Are you sure you want to reset all theme settings (Color, Layout & Typography, Branding) back to the default theme's original configuration? This will revert everything to the default theme's initial state.",
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
    s.tab("layout_typography", _("Layout & Typography"));
    s.tab("icons_branding", _("Branding"));

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
      "layout_typography",
      form.SectionValue,
      "_structure_layout",
      form.NamedSection,
      "theme",
      "aurora",
      _("Layout"),
      _(
        "Adjust navigation style, element spacing, corner radius, and page container width.",
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
      "struct_radius_base",
      _("Border Radius"),
    );
    so.default = "0.5rem";
    so.placeholder = "0.5rem";
    so.rmempty = false;
    so.render = renderRadiusControl;

    so = structureSubsection.option(
      form.Value,
      "struct_container_max_width",
      _("Page Container Max Width"),
    );
    so.default = "80rem";
    so.placeholder = "80rem";
    so.rmempty = false;
    so.render = renderContainerMaxWidthControl;

    const fontSection = s.taboption(
      "layout_typography",
      form.SectionValue,
      "_font_settings",
      form.NamedSection,
      "theme",
      "aurora",
      _("Font Settings"),
      _(
        "Sans-serif sets the global UI typeface for all text and headings. Monospace is used for code blocks, inline code, and variable references.",
      ),
    );
    const fontSubsection = fontSection.subsection;

    const fontSlotOpts = {};

    const findFontByPreset = (slot, preset) =>
      buildFontOptions(slot).find((font) => font.name === preset);

    const findFontByStack = (slot, stack) =>
      buildFontOptions(slot).find((font) => font.stack === stack);

    const getDefaultFont = (slot) =>
      findFontByPreset(slot, "default") || buildFontOptions(slot)[0];

    const addFontSlot = (ss, slot) => {
      const options = buildFontOptions(slot);
      const stackKey = "struct_font_" + slot;
      const defaultFont = getDefaultFont(slot);

      const presetOpt = ss.option(
        form.ListValue,
        stackKey,
        slot === "sans" ? _("Sans-serif Typeface") : _("Monospace Typeface"),
      );
      presetOpt.default = themeConfig[stackKey] || defaultFont?.stack || "";
      presetOpt.rmempty = false;
      options.forEach((font) => {
        if (font.stack) {
          presetOpt.value(
            font.stack,
            font.source
              ? "%s (%s)".format(font.label, font.source)
              : font.label,
          );
        }
      });
      fontSlotOpts[slot] = presetOpt;
    };

    addFontSlot(fontSubsection, "sans");
    addFontSlot(fontSubsection, "mono");

    const getFontSelection = (slot) => {
      const value =
        (fontSlotOpts[slot] && fontSlotOpts[slot].formvalue("theme")) ||
        getDefaultFont(slot)?.stack ||
        "";
      const font = findFontByStack(slot, value) ||
        getDefaultFont(slot) || { name: "default" };

      return {
        preset: font.name || "default",
        stack: font.stack || value,
      };
    };

    const getSelectedFonts = () => {
      const sans = getFontSelection("sans");
      const mono = getFontSelection("mono");

      return {
        sans: sans.preset,
        mono: mono.preset,
        sansStack: sans.stack,
        monoStack: mono.stack,
      };
    };

    const applyFontCss = (selected) => {
      return fetch(
        "/luci-static/aurora/fonts/aurora-font.css?v=" + Date.now(),
        { cache: "no-store" },
      )
        .then((r) => {
          if (!r.ok) throw new Error(_("Font CSS file is not available"));
          return r.text();
        })
        .then((css) => {
          if (!css) throw new Error(_("Font CSS file is empty"));

          let styleEl = document.getElementById("aurora-preview-fonts");
          if (!styleEl) {
            styleEl = document.createElement("style");
            styleEl.id = "aurora-preview-fonts";
            document.head.appendChild(styleEl);
          }
          styleEl.textContent = css;

          if (selected.sansStack) {
            document.documentElement.style.setProperty(
              "--font-sans",
              selected.sansStack,
            );
          }
          if (selected.monoStack) {
            document.documentElement.style.setProperty(
              "--font-mono",
              selected.monoStack,
            );
          }
        });
    };

    const pollFontCache = (jobId, remaining, selected) => {
      if (!jobId || remaining <= 0) return;

      window.setTimeout(() => {
        L.resolveDefault(callGetFontStatus(jobId), {}).then((status) => {
          if (status && status.state === "done") {
            const current = getSelectedFonts();
            if (
              current.sans === selected.sans &&
              current.mono === selected.mono
            ) {
              applyFontCss(selected);
            }
          } else if (status && status.state !== "missing") {
            pollFontCache(jobId, remaining - 1, selected);
          }
        });
      }, 1500);
    };

    const prepareSelectedFonts = () => {
      const selected = getSelectedFonts();
      const statusNode = E(
        "p",
        { class: "spinning" },
        _("Preparing selected fonts..."),
      );

      ui.showModal(_("Preparing Fonts"), [statusNode]);

      return callPrepareFont(selected.sans, selected.mono)
        .then((res) => {
          if (!res || res.result !== 0) {
            throw new Error(res?.error || _("unknown error"));
          }

          pollFontCache(res.job_id, 20, selected);

          return applyFontCss(selected);
        })
        .then(() => {
          ui.hideModal();
        })
        .catch((err) => {
          ui.hideModal();
          ui.addNotification(
            null,
            E(
              "p",
              _("Font preparation failed: ") + (err.message || String(err)),
            ),
            "warning",
          );
          return Promise.reject(err);
        });
    };

    this.prepareAuroraFonts = prepareSelectedFonts;

    const assetSection = s.taboption(
      "icons_branding",
      form.SectionValue,
      "_asset_library",
      form.NamedSection,
      "theme",
      "aurora",
      _("Asset Library"),
      _(
        "Manage image files used by the theme. All files are stored in <code>/www/luci-static/aurora/images/</code>.",
      ),
    );
    const assetSubsection = assetSection.subsection;

    const assetTableSo = assetSubsection.option(
      form.DummyValue,
      "_asset_table",
      " ",
    );
    assetTableSo.load = () => L.resolveDefault(callListIcons(), { icons: [] });
    assetTableSo.cfgvalue = (section_id, data) => data?.icons || [];
    assetTableSo.render = function (option_index, section_id, in_table) {
      return this.load(section_id).then((data) => {
        const icons = this.cfgvalue(section_id, data);
        const tmpPath = "/tmp/aurora_icon.tmp";

        const fileInput = E("input", {
          type: "file",
          style: "display:none",
          accept: "image/*,.svg",
        });

        const progressBar = E("div", {
          style:
            "height:100%;width:0%;transition:width 0.15s;border-radius:2px;background:var(--color-primary,#2196f3);",
        });
        const progressFilename = E("span", {}, "");
        const progressPct = E("span", {}, "0%");
        const progressRow = E(
          "div",
          {
            style:
              "display:none;margin-bottom:0.75em;padding:0.6em 0.875em;border-radius:0.375em;border:1px solid var(--border-color,#ddd);",
          },
          [
            E(
              "div",
              {
                style:
                  "display:flex;justify-content:space-between;align-items:center;font-size:0.85em;margin-bottom:0.4em;",
              },
              [progressFilename, progressPct],
            ),
            E(
              "div",
              {
                style:
                  "height:4px;border-radius:2px;overflow:hidden;background:var(--border-color,#eee);",
              },
              [progressBar],
            ),
          ],
        );

        const setUploading = (busy) => {
          dropzone.style.opacity = busy ? "0.5" : "";
          dropzone.style.pointerEvents = busy ? "none" : "";
          progressRow.style.display = busy ? "block" : "none";
        };

        const dropzone = E(
          "div",
          {
            style:
              "border:2px dashed var(--border-color,#aaa);border-radius:0.5em;padding:1.25em 1em;text-align:center;cursor:pointer;margin-bottom:0.75em;transition:border-color 0.15s,background 0.15s;",
            click: () => fileInput.click(),
            dragover: (e) => {
              e.preventDefault();
              dropzone.style.borderColor = "var(--color-primary,#2196f3)";
              dropzone.style.background = "rgba(33,150,243,0.06)";
            },
            dragleave: () => {
              dropzone.style.borderColor = "";
              dropzone.style.background = "";
            },
            drop: (e) => {
              e.preventDefault();
              dropzone.style.borderColor = "";
              dropzone.style.background = "";
              const file = e.dataTransfer.files[0];
              if (file) uploadFile(file);
            },
          },
          [
            E(
              "div",
              {
                style:
                  "font-size:1.5em;margin-bottom:0.25em;pointer-events:none;",
              },
              "⬆",
            ),
            E(
              "strong",
              { style: "pointer-events:none;" },
              _("Drop image here, or click to browse"),
            ),
            E(
              "div",
              {
                style:
                  "font-size:0.8em;opacity:0.6;margin-top:0.25em;pointer-events:none;",
              },
              _("JPG · PNG · WebP · AVIF · SVG · GIF"),
            ),
          ],
        );

        const uploadFile = (file) => {
          fileInput.value = "";
          progressFilename.textContent = file.name;
          progressPct.textContent = "0%";
          progressBar.style.width = "0%";
          setUploading(true);

          const xhr = new XMLHttpRequest();

          xhr.upload.addEventListener("progress", (e) => {
            if (e.lengthComputable) {
              const pct = Math.round((e.loaded / e.total) * 100);
              progressBar.style.width = pct + "%";
              progressPct.textContent = pct + "%";
            }
          });

          xhr.addEventListener("load", () => {
            if (xhr.status !== 200) {
              setUploading(false);
              ui.addNotification(
                null,
                E("p", _("Upload failed (HTTP %s)").format(xhr.status)),
                "error",
              );
              return;
            }
            L.resolveDefault(callUploadIcon(file.name), {}).then((ret) => {
              if (ret?.result === 0) {
                if (/^login-bg\./i.test(file.name)) {
                  localStorage.setItem("aurora.pending_bg", file.name);
                }
                window.location.reload();
              } else {
                setUploading(false);
                ui.addNotification(
                  null,
                  E(
                    "p",
                    _("Upload failed: %s").format(ret?.error || "Unknown"),
                  ),
                  "error",
                );
                L.resolveDefault(fs.remove(tmpPath), {});
              }
            });
          });

          xhr.addEventListener("error", () => {
            setUploading(false);
            ui.addNotification(null, E("p", _("Upload failed")), "error");
          });

          const formData = new FormData();
          formData.append("sessionid", rpc.getSessionID());
          formData.append("filename", tmpPath);
          formData.append("filemode", "0600");
          formData.append("filedata", file, file.name);

          xhr.open("POST", "/cgi-bin/cgi-upload");
          xhr.withCredentials = true;
          xhr.send(formData);
        };

        fileInput.addEventListener("change", () => {
          const file = fileInput.files[0];
          fileInput.value = "";
          if (file) uploadFile(file);
        });

        const idleCallback = window.requestIdleCallback
          ? (fn) => window.requestIdleCallback(fn, { timeout: 2000 })
          : (fn) => setTimeout(fn, 100);

        const makeRow = (icon) => {
          const placeholder = E("div", {
            style:
              "width:40px;height:40px;border-radius:4px;background:var(--border-color,#eee);",
          });
          const previewCell = E(
            "td",
            { class: "td", style: "width:56px;" },
            placeholder,
          );

          idleCallback(() => {
            generateLqip("/luci-static/aurora/images/" + icon).then(
              (dataUrl) => {
                if (!dataUrl) return;
                placeholder.replaceWith(
                  E("img", {
                    src: dataUrl,
                    style:
                      "width:40px;height:40px;object-fit:contain;border-radius:4px;display:block;",
                    alt: "",
                  }),
                );
              },
            );
          });

          const deleteBtn = E(
            "button",
            {
              class: "cbi-button cbi-button-remove",
              click: ui.createHandlerFn(this, () => {
                return ui.showModal(_("Delete Asset"), [
                  E("p", {}, _("Delete '%s'?").format(icon)),
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
                          ui.showModal(_("Deleting…"), [
                            E("p", { class: "spinning" }, _("Please wait…")),
                          ]);
                          L.resolveDefault(callRemoveIcon(icon), {}).then(
                            (ret) => {
                              ui.hideModal();
                              if (ret?.result === 0) {
                                ui.addNotification(
                                  null,
                                  E("p", _("Deleted: %s").format(icon)),
                                );
                                window.location.reload();
                              } else {
                                ui.addNotification(
                                  null,
                                  E(
                                    "p",
                                    _("Failed to delete: %s").format(
                                      ret?.error || "Unknown",
                                    ),
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

          return E("tr", { class: "tr" }, [
            previewCell,
            E("td", { class: "td", style: "font-family:monospace;" }, icon),
            E("td", { class: "td center" }, deleteBtn),
          ]);
        };

        const tableOrEmpty =
          icons.length === 0
            ? E("div", { style: "padding:0.5em 0;" }, [
                E("em", {}, _("No assets uploaded yet.")),
              ])
            : E("table", { class: "table" }, [
                E("tr", { class: "tr table-titles" }, [
                  E("th", { class: "th", style: "width:56px;" }, _("Preview")),
                  E("th", { class: "th" }, _("Filename")),
                  E("th", { class: "th center" }, _("Actions")),
                ]),
                ...icons.map(makeRow),
              ]);

        return E("div", { "data-name": this.option }, [
          fileInput,
          dropzone,
          progressRow,
          tableOrEmpty,
        ]);
      });
    };

    const logoSection = s.taboption(
      "icons_branding",
      form.SectionValue,
      "_branding_settings",
      form.NamedSection,
      "theme",
      "aurora",
      _("Site Branding"),
      _(
        "Choose the favicon, logo, and login background. Upload images via the Asset Library above.",
      ),
    );
    const logoSubsection = logoSection.subsection;

    so = logoSubsection.option(form.ListValue, "logo_svg", _("Logo / Favicon"));
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
                if (isImageFile(icon)) {
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
      "favicon_png",
      _("Favicon (PNG)"),
    );
    so.description = _(
      "Optional PNG favicon for browsers that do not support SVG favicons.",
    );
    so.rmempty = true;
    so.load = function (section_id) {
      return L.resolveDefault(callListIcons(), { icons: [] }).then(
        L.bind(function (response) {
          const icons = response?.icons || [];
          this.keylist = [];
          this.vallist = [];
          this.value("", _("(None)"));
          icons.forEach(
            L.bind(function (icon) {
              if (/\.png$/i.test(icon)) this.value(icon, icon);
            }, this),
          );
          return form.ListValue.prototype.load.apply(this, [section_id]);
        }, this),
      );
    };

    so = logoSubsection.option(
      form.ListValue,
      "favicon_ico",
      _("Favicon (ICO / Legacy)"),
    );
    so.description = _("ICO favicon served to legacy browsers as fallback.");
    so.default = "favicon.ico";
    so.rmempty = false;
    so.load = function (section_id) {
      return L.resolveDefault(callListIcons(), { icons: [] }).then(
        L.bind(function (response) {
          const icons = response?.icons || [];
          this.keylist = [];
          this.vallist = [];
          icons.forEach(
            L.bind(function (icon) {
              if (/\.ico$/i.test(icon)) this.value(icon, icon);
            }, this),
          );
          return form.ListValue.prototype.load.apply(this, [section_id]);
        }, this),
      );
    };

    const pwaIconSlots = [
      ["pwa_apple_touch", _("Apple Touch Icon"), "apple-touch-icon.png"],
      ["pwa_icon_192", _("App Icon 192×192"), "app-icon-192x192.png"],
      ["pwa_icon_512", _("App Icon 512×512"), "app-icon-512x512.png"],
    ];

    pwaIconSlots.forEach(function ([key, label, defaultVal]) {
      so = logoSubsection.option(form.ListValue, key, label);
      so.default = defaultVal;
      so.rmempty = false;
      so.load = function (section_id) {
        return L.resolveDefault(callListIcons(), { icons: [] }).then(
          L.bind(function (response) {
            const icons = response?.icons || [];
            this.keylist = [];
            this.vallist = [];
            icons.forEach(
              L.bind(function (icon) {
                if (isImageFile(icon) && !/\.svg$/i.test(icon)) {
                  this.value(icon, icon);
                }
              }, this),
            );
            return form.ListValue.prototype.load.apply(this, [section_id]);
          }, this),
        );
      };
    });

    so = logoSubsection.option(
      form.ListValue,
      "struct_login_bg",
      _("Login Background"),
    );
    so.description = _("Full-screen background on the login page.");
    so.rmempty = true;
    so.load = function (section_id) {
      return L.resolveDefault(callListIcons(), { icons: [] }).then(
        L.bind((response) => {
          const icons = response?.icons || [];
          this.keylist = [];
          this.vallist = [];
          this.value("", _("None"));
          if (icons.length > 0) {
            icons.forEach(
              L.bind((icon) => {
                if (isImageFile(icon) && !icon.endsWith(".svg")) {
                  this.value(toLoginBgUrl(icon), icon);
                }
              }, this),
            );
          }
          return form.ListValue.prototype.load.apply(this, [section_id]);
        }, this),
      );
    };
    so.cfgvalue = function (section_id) {
      return uci.get("aurora", section_id, "struct_login_bg") || "";
    };
    so.write = function (section_id, value) {
      if (!value) {
        uci.unset("aurora", section_id, "struct_login_bg");
        uci.unset("aurora", section_id, "light_login_bg_lqip");
        return;
      }
      uci.set("aurora", section_id, "struct_login_bg", value);
    };

    {
      const _renderBg = so.render.bind(so);
      so.render = function (option_index, section_id, in_table) {
        return _renderBg(option_index, section_id, in_table).then((el) => {
          const select = el.querySelector("select");
          if (select) {
            select.addEventListener("change", function () {
              const lqipEl = document.querySelector(
                '[name="cbid.aurora.theme.light_login_bg_lqip"]',
              );
              if (!this.value) {
                if (lqipEl) lqipEl.value = "";
                return;
              }
              const m = this.value.match(/url\(["']?(.+?)["']?\)/);
              if (!m || !lqipEl) return;
              generateLqip(m[1]).then((data) => {
                if (data && lqipEl) lqipEl.value = data;
              });
            });
          }
          return el;
        });
      };
    }

    const lqipSo = logoSubsection.option(form.Value, "light_login_bg_lqip", "");
    lqipSo.rmempty = true;
    lqipSo.render = function (option_index, section_id, in_table) {
      return form.Value.prototype.render.apply(this, arguments).then((el) => {
        el.style.display = "none";
        return el;
      });
    };

    const toolbarSection = s.taboption(
      "icons_branding",
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
      _("Add, remove, and drag to reorder toolbar buttons."),
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

        const applyUpdateStatus = (data) => {
          if (!data) return;
          updateVersionLabel(labels.theme, data.theme?.update_available);
          updateVersionLabel(labels.config, data.config?.update_available);
        };

        const cached = utils_version_api.versionCache?.get?.();
        if (cached) {
          applyUpdateStatus(cached);
        } else {
          setTimeout(() => {
            L.resolveDefault(utils_version_api.callCheckUpdates(), null)
              .then((data) => {
                if (data) {
                  utils_version_api.versionCache.set(data);
                  applyUpdateStatus(data);
                }
              })
              .catch(() => {});
          }, 0);
        }
      });

      // Auto-select uploaded background and auto-generate LQIP if missing
      requestAnimationFrame(() => {
        const bgInput = mapNode.querySelector(
          '[name="cbid.aurora.theme.struct_login_bg"]',
        );
        const lqipInput = mapNode.querySelector(
          '[name="cbid.aurora.theme.light_login_bg_lqip"]',
        );
        if (!bgInput || !lqipInput) return;

        const pending = localStorage.getItem("aurora.pending_bg");
        if (pending) {
          localStorage.removeItem("aurora.pending_bg");
          const pendingUrl = toLoginBgUrl(pending);
          if (bgInput.querySelector(`option[value="${pendingUrl}"]`)) {
            bgInput.value = pendingUrl;
            bgInput.dispatchEvent(new Event("change"));
            return;
          }
        }

        if (bgInput.value && !lqipInput.value) {
          const bgMatch = bgInput.value.match(/url\(["']?(.+?)["']?\)/);
          if (bgMatch) {
            generateLqip(bgMatch[1]).then((d) => {
              if (d) lqipInput.value = d;
            });
          }
        }
      });

      return mapNode;
    });
  },
});
