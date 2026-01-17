"use strict";
"require view";
"require form";
"require uci";
"require rpc";
"require ui";
"require fs";

document.querySelector("head").appendChild(
  E("script", {
    type: "text/javascript",
    src: L.resource("view/aurora/color.global.js"),
  })
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
  params: ["force_refresh"],
});

const callGetInstalledVersions = rpc.declare({
  object: "luci.aurora",
  method: "get_installed_versions",
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
        title: _("Color Picker Helper"),
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
    description
  );
  addColorInputs(o.subsection, colorVars);
};

const createColorSections = (ss, mode, colorVars) => {
  const sections = [
    {
      key: "gradient",
      title: _("Gradient Colors"),
      description: _(
        "Configure gradient colors used for backgrounds and progress bars.The theme background uses a three-color gradient, and progress bars use a two-color gradient."
      ),
    },
    {
      key: "semantic",
      title: _("Semantic Colors"),
      description: _(
        "Semantic colors convey different operational behaviors, primarily used for buttons and badge elements. Each semantic type has two colors: the base color for backgrounds and the text color for content. The primary color affects form components (input, radio, checkbox, textarea, select, dynamic list) in hover, focus, and active states."
      ),
    },
    {
      key: "status",
      title: _("Status Colors"),
      description: _(
        "Status colors indicate different system states and feedback (default, success, info, warning, error). Each status has two colors: the base color for backgrounds and the text color for content. Applied to tooltips, alert messages, labels, and legends."
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

const renderSpacingControl = function (option_index, section_id, in_table) {
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
      const numValue = parseFloat(input.value || self.default) || 0.25;
      const valueDisplay = E(
        "span",
        {
          style: "margin-left: 10px; min-width: 60px; display: inline-block;",
        },
        `${numValue.toFixed(2)}rem`
      );
      const rangeInput = E("input", {
        type: "range",
        min: "-0.1",
        max: "0.5",
        step: "0.05",
        value: numValue,
        style: "width: 200px; vertical-align: middle;",
        input: function () {
          const val = `${parseFloat(this.value).toFixed(2)}rem`;
          input.value = val;
          valueDisplay.textContent = val;
        },
      });
      input.parentNode.appendChild(rangeInput);
      input.parentNode.appendChild(valueDisplay);
    }
    return element;
  });
};

const createIconUploadButton = (ss, tmpPath) => {
  const so = ss.option(form.Button, "_upload_icon", _("Upload Icon"));
  so.inputstyle = "add";
  so.inputtitle = _("Upload Icon...");
  so.onclick = ui.createHandlerFn(this, () => {
    return ui
      .uploadFile(tmpPath, event.target)
      .then((res) => {
        if (!res?.name) throw new Error(_("No file selected or upload failed"));
        const filename = res.name.split("/").pop().split("\\").pop();
        return L.resolveDefault(callUploadIcon(filename), {})
          .then((ret) => {
            if (ret?.result === 0) {
              ui.addNotification(
                null,
                E("p", _("Icon uploaded successfully: %s").format(filename))
              );
              setTimeout(() => window.location.reload(), 1000);
            } else {
              const errorMsg = ret?.error || "Unknown error";
              ui.addNotification(
                null,
                E("p", _("Failed to upload icon: %s").format(errorMsg))
              );
              return L.resolveDefault(fs.remove(tmpPath), {});
            }
          })
          .catch((err) => {
            ui.addNotification(
              null,
              E("p", _("RPC call failed: %s").format(err.message || err))
            );
            return L.resolveDefault(fs.remove(tmpPath), {});
          });
      })
      .catch((e) => {
        ui.addNotification(
          null,
          E("p", _("Upload error: %s").format(e.message))
        );
        return L.resolveDefault(fs.remove(tmpPath), {});
      });
  });
};

const createIconList = (ss) => {
  const so = ss.option(form.DummyValue, "_icon_list", _("Uploaded Icons"));
  so.rawhtml = true;
  so.cfgvalue = () => {
    return L.resolveDefault(callListIcons(), { icons: [] }).then((response) => {
      const icons = response?.icons || [];
      if (icons.length === 0) return `<em>${_("No icons uploaded yet.")}</em>`;

      let html = '<ul style="list-style: none; padding: 0; margin: 10px 0;">';
      icons.forEach((icon) => {
        html += `<li style="padding: 8px 0; border-bottom: 1px solid rgba(0,0,0,0.1); display: flex; justify-content: space-between; align-items: center;">
					<span style="font-family: monospace;">${icon}</span>
					<button class="cbi-button cbi-button-remove" data-icon="${icon}" style="margin-left: 10px;">${_(
          "Delete"
        )}</button>
				</li>`;
      });
      html += "</ul>";

      setTimeout(() => {
        const container = document.querySelector(
          '[data-name="_icon_list"] .cbi-value-field'
        );
        if (container && !container.dataset.listenerAttached) {
          container.dataset.listenerAttached = "true";
          container.addEventListener("click", (e) => {
            if (
              e.target.classList.contains("cbi-button-remove") &&
              e.target.dataset.icon
            ) {
              const icon = e.target.dataset.icon;
              if (confirm(_("Delete icon '%s'?").format(icon))) {
                L.resolveDefault(callRemoveIcon(icon), {}).then((ret) => {
                  if (ret.result === 0) {
                    ui.addNotification(
                      null,
                      E("p", _("Icon deleted: %s").format(icon))
                    );
                    window.location.reload();
                  } else {
                    ui.addNotification(
                      null,
                      E("p", _("Failed to delete icon: %s").format(icon))
                    );
                  }
                });
              }
            }
          });
        }
      }, 100);

      return html;
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
          "oklch(0.984 0.003 247.858)",
          _("Background Start Color"),
        ],
        [
          "light_background_mid",
          "oklch(0.968 0.007 247.896)",
          _("Background Mid Color"),
        ],
        [
          "light_background_end",
          "oklch(0.929 0.013 255.508)",
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
    };

    const m = new form.Map("aurora", _("Aurora Theme Settings"));

    const themeVersion =
      installedVersions?.theme?.installed_version || "Unknown";
    const configVersion =
      installedVersions?.config?.installed_version || "Unknown";

    m.description =
      '<span id="aurora-versions">Theme: <span id="theme-version" class="label success" style="cursor: pointer;">v' +
      themeVersion +
      '</span> | Config: <span id="config-version" class="label success" style="cursor: pointer;">v' +
      configVersion +
      "</span></span>";

    const s = m.section(form.NamedSection, "theme", "aurora");

    s.tab("colors", _("Color"));
    s.tab("structure", _("Structure"));
    s.tab("toolbar", _("Floating Toolbar"));

    const colorSection = s.taboption(
      "colors",
      form.SectionValue,
      "_colors",
      form.NamedSection,
      "theme",
      "aurora"
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
        "Layout settings control the navigation submenu display style and global component spacing."
      )
    );
    const structureSubsection = structureSection.subsection;

    let so = structureSubsection.option(
      form.ListValue,
      "nav_submenu_type",
      _("Navigation Submenu Type")
    );
    so.value("mega-menu", _("Mega Menu"));
    so.value("boxed-dropdown", _("Boxed Dropdown"));
    so.default = "mega-menu";
    so.rmempty = false;

    so = structureSubsection.option(form.Flag, "toolbar_enabled", _("Floating Toolbar"));
    so.default = "1";
    so.rmempty = false;

    so = structureSubsection.option(form.Value, "struct_spacing", _("Spacing"));
    so.default = "0.25rem";
    so.placeholder = "0.25rem";
    so.rmempty = false;
    so.render = renderSpacingControl;

    const iconSection = s.taboption(
      "toolbar",
      form.SectionValue,
      "_icon_management",
      form.NamedSection,
      "theme",
      "aurora",
      _("Icon Management"),
      _(
        "Upload and manage custom icons for toolbar items. Icons are stored in <code>/www/luci-static/aurora/images/</code>."
      )
    );
    const iconSubsection = iconSection.subsection;
    createIconUploadButton(iconSubsection, "/tmp/aurora_icon.tmp");
    createIconList(iconSubsection);

    const toolbarSection = s.taboption(
      "toolbar",
      form.SectionValue,
      "_toolbar",
      form.GridSection,
      "toolbar_item",
      _("Toolbar Items"),
      _(
        "Configure the floating button group items. You can add, edit, remove, and reorder items by dragging."
      )
    );
    const toolbarSubsection = toolbarSection.subsection;
    toolbarSubsection.addremove = true;
    toolbarSubsection.sortable = true;
    toolbarSubsection.anonymous = true;
    toolbarSubsection.nodescriptions = true;

    so = toolbarSubsection.option(form.Flag, "enabled", _("Enabled"));
    so.default = "1";
    so.rmempty = false;
    so.editable = true;

    so = toolbarSubsection.option(form.Value, "title", _("Title"));
    so.rmempty = false;
    so.placeholder = _("Button Title");
    so.validate = (section_id, value) =>
      !value?.trim() ? _("Title is required") : true;

    so = toolbarSubsection.option(form.Value, "url", _("URL"));
    so.rmempty = false;
    so.placeholder = "/cgi-bin/luci/...";
    so.validate = (section_id, value) =>
      !value?.trim() ? _("URL is required") : true;

    so = toolbarSubsection.option(form.ListValue, "icon", _("Icon"));
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
        }, this)
      );
    };
    so.validate = (section_id, value) =>
      !value?.trim() ? _("Icon is required") : true;

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

        L.resolveDefault(callCheckUpdates(0), null)
          .then((updateData) => {
            updateVersionLabel(
              labels.theme,
              updateData?.theme?.update_available
            );
            updateVersionLabel(
              labels.config,
              updateData?.config?.update_available
            );
          })
          .catch((err) => console.error("Failed to check version:", err));
      });

      return mapNode;
    });
  },
});
