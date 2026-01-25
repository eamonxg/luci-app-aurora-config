"use strict";
"require view";
"require form";
"require uci";
"require rpc";
"require ui";
"require fs";

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

const callResetDefaults = rpc.declare({
  object: "luci.aurora",
  method: "reset_defaults",
});

const renderColorPicker = function (option_index, section_id, in_table) {
  const el = form.Value.prototype.render.apply(this, [
    option_index,
    section_id,
    in_table,
  ]);
  return Promise.resolve(el).then((element) => {
    const input = element.querySelector('input[type="text"]');
    if (input) {
      const color = new Color(input.value);
      if (color.alpha < 1) color.alpha = 1;
      const colorInput = E("input", {
        type: "color",
        value: color.toString({ format: "hex" }),
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

const addColorInputs = (ss, colorVars) => {
  colorVars.forEach(([key, defaultValue, label]) => {
    const so = ss.option(form.Value, key, label);
    so.default = defaultValue;
    so.placeholder = defaultValue;
    so.rmempty = false;
    so.render = renderColorPicker;
  });
};

const createColorSection = (ss, tab, id, title, description, colorVars) => {
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
  addColorInputs(o.subsection, colorVars);
};

const createColorSections = (ss, mode, colorVars) => {
  const sections = [
    {
      key: "gradient",
      title: _("Gradient Colors"),
      description: _(
        "Customize the gradient colors used throughout the interface. The page background uses a smooth three-color gradient (start, middle, end), while progress bars use a two-color gradient (start, end).",
      ),
    },
    {
      key: "semantic",
      title: _("Semantic Colors"),
      description: _(
        "Define colors that represent different actions and behaviors. These colors are used for buttons and badges. Each type has two colors: a background color and a text color. The primary color also affects interactive form elements (inputs, checkboxes, radio buttons, etc.) when you hover over or interact with them.",
      ),
    },
    {
      key: "status",
      title: _("Status Colors"),
      description: _(
        "Set colors that indicate system status and feedback messages. Each status type (default, success, info, warning, error) has two colors: a background color and a text color. These are used in tooltips, alert messages, status labels, and legends throughout the interface.",
      ),
    },
    {
      key: "component",
      title: _("Component Colors"),
      description: _(
        "Set colors for major interface components including headers, view backgrounds, and card containers.",
      ),
    },
  ];

  sections.forEach(({ key, title, description }) => {
    const id = `_${mode}_${key}`;
    const vars =
      colorVars[`${mode}${key.charAt(0).toUpperCase()}${key.slice(1)}`];
    createColorSection(ss, mode, id, title, description, vars);
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
      L.resolveDefault(callGetInstalledVersions(), {}),
    ]);
  },

  render(loadData) {
    const installedVersions = loadData[1];

    const colorVars = {
      lightGradient: [
        [
          "light_background_start",
          "oklch(0.968 0.007 247.896)",
          _("Background Start Color"),
        ],
        [
          "light_background_mid",
          "oklch(0.968 0.007 247.896)",
          _("Background Mid Color"),
        ],
        [
          "light_background_end",
          "oklch(0.968 0.007 247.896)",
          _("Background End Color"),
        ],
        [
          "light_progress_start",
          "oklch(0.68 0.11 233)",
          _("Progress Start Color"),
        ],
        [
          "light_progress_end",
          "oklch(0.7535 0.1034 198.37)",
          _("Progress End Color"),
        ],
      ],
      darkGradient: [
        [
          "dark_background_start",
          "oklch(0.2077 0.0398 265.75)",
          _("Background Start Color"),
        ],
        [
          "dark_background_mid",
          "oklch(0.3861 0.059 188.42)",
          _("Background Mid Color"),
        ],
        [
          "dark_background_end",
          "oklch(0.4318 0.0865 166.91)",
          _("Background End Color"),
        ],
        [
          "dark_progress_start",
          "oklch(0.4318 0.0865 166.91)",
          _("Progress Start Color"),
        ],
        [
          "dark_progress_end",
          "oklch(62.1% 0.145 189.632)",
          _("Progress End Color"),
        ],
      ],
      lightSemantic: [
        ["light_primary", "oklch(0.68 0.11 233)", _("Primary Color")],
        [
          "light_primary_text",
          "oklch(0.6656 0.1055 234.61)",
          _("Primary Text Color"),
        ],
        ["light_muted", "oklch(0.97 0 0)", _("Muted Color")],
        ["light_muted_text", "oklch(0.35 0 0)", _("Muted Text Color")],
        ["light_accent", "oklch(0.62 0.22 25)", _("Accent Color")],
        ["light_accent_text", "oklch(0.97 0.02 25)", _("Accent Text Color")],
        ["light_destructive", "oklch(0.94 0.05 25)", _("Destructive Color")],
        [
          "light_destructive_text",
          "oklch(0.35 0.12 25)",
          _("Destructive Text Color"),
        ],
      ],
      darkSemantic: [
        ["dark_primary", "oklch(0.48 0.118 190.485)", _("Primary Color")],
        [
          "dark_primary_text",
          "oklch(0.73 0.168 188.745)",
          _("Primary Text Color"),
        ],
        ["dark_muted", "oklch(0.373 0.026 259.733)", _("Muted Color")],
        ["dark_muted_text", "oklch(0.82 0.035 259.733)", _("Muted Text Color")],
        ["dark_accent", "oklch(0.35 0.12 25)", _("Accent Color")],
        ["dark_accent_text", "oklch(0.88 0.14 25)", _("Accent Text Color")],
        [
          "dark_destructive",
          "oklch(0.258 0.092 26.042)",
          _("Destructive Color"),
        ],
        [
          "dark_destructive_text",
          "oklch(0.88 0.14 26.042)",
          _("Destructive Text Color"),
        ],
      ],
      lightStatus: [
        ["light_success", "oklch(0.94 0.05 160)", _("Success Color")],
        ["light_success_text", "oklch(0.32 0.09 165)", _("Success Text Color")],
        ["light_info", "oklch(0.94 0.05 230)", _("Info Color")],
        ["light_info_text", "oklch(0.35 0.08 240)", _("Info Text Color")],
        ["light_warning", "oklch(0.95 0.05 90)", _("Warning Color")],
        ["light_warning_text", "oklch(0.35 0.08 60)", _("Warning Text Color")],
        ["light_error", "oklch(0.94 0.05 25)", _("Error Color")],
        ["light_error_text", "oklch(0.35 0.12 25)", _("Error Text Color")],
        ["light_default", "oklch(0.97 0 0)", _("Default Color")],
        ["light_default_text", "oklch(0.205 0 0)", _("Default Text Color")],
      ],
      darkStatus: [
        ["dark_success", "oklch(0.378 0.077 168.94/0.5)", _("Success Color")],
        ["dark_success_text", "oklch(0.92 0.09 160)", _("Success Text Color")],
        ["dark_info", "oklch(0.391 0.09 240.876/0.5)", _("Info Color")],
        ["dark_info_text", "oklch(0.88 0.06 230)", _("Info Text Color")],
        ["dark_warning", "oklch(0.414 0.112 45.904/0.5)", _("Warning Color")],
        [
          "dark_warning_text",
          "oklch(0.924 0.12 95.746)",
          _("Warning Text Color"),
        ],
        ["dark_error", "oklch(0.41 0.159 10.272/0.5)", _("Error Color")],
        ["dark_error_text", "oklch(0.88 0.14 25)", _("Error Text Color")],
        ["dark_default", "oklch(0.274 0.006 286.033/0.5)", _("Default Color")],
        [
          "dark_default_text",
          "oklch(0.985 0.01 285.805)",
          _("Default Text Color"),
        ],
      ],
      lightComponent: [
        [
          "light_header_bg",
          "oklch(0.968 0.007 247.896)",
          _("Header Background"),
        ],
        ["light_view_bg", "oklch(1 0 0)", _("View Background")],
        ["light_card_bg", "oklch(1 0 0)", _("Card Background")],
      ],
      darkComponent: [
        ["dark_header_bg", "oklch(0.21 0.034 264.665)", _("Header Background")],
        ["dark_view_bg", "oklch(0.21 0.034 264.665)", _("View Background")],
        ["dark_card_bg", "oklch(0.279 0.041 260.031)", _("Card Background")],
      ],
    };

    const m = new form.Map("aurora", _("Aurora Theme Settings"));

    const themeVersion =
      installedVersions?.theme?.installed_version || "Unknown";
    const configVersion =
      installedVersions?.config?.installed_version || "Unknown";

    const headerBar = E(
      "div",
      {
        style:
          "display: flex; flex-wrap: wrap; gap: 1em; align-items: center; justify-content: space-between;",
      },
      [
        E("div", { style: "display: flex; flex-wrap: wrap; gap: 1em;" }, [
          E("span", { style: "white-space: nowrap;" }, [
            document.createTextNode("Theme: "),
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
            document.createTextNode("Config: "),
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
        E(
          "button",
          {
            class: "cbi-button cbi-button-reset",
            click: ui.createHandlerFn(this, function () {
              return ui.showModal(_("Reset to Defaults"), [
                E(
                  "p",
                  {},
                  _(
                    "Are you sure you want to reset all theme settings to original defaults?",
                  ),
                ),
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
                                  _("Error: %s").format(
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
                    _("Confirm Reset"),
                  ),
                ]),
              ]);
            }),
          },
          _("Reset to Defaults"),
        ),
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

    createColorSections(colorSubsection, "light", colorVars);
    createColorSections(colorSubsection, "dark", colorVars);

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

    let so = structureSubsection.option(
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
