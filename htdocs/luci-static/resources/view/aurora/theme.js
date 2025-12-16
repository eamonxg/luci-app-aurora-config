"use strict";
"require view";
"require form";
"require uci";

document.querySelector("head").appendChild(
  E("script", {
    type: "text/javascript",
    src: L.resource("view/aurora/color.global.js"),
  })
);

const createSectionTitle = (title) => `<h5>${_(title)}</h5>`;

const addColorInputs = (ss, tab, colorVars, prefix) => {
  for (const item of colorVars) {
    const key = item[0];
    const defaultValue = item[1];
    const label = item[2];
    const so = ss.taboption(tab, form.Value, key, label);
    so.default = defaultValue;
    so.placeholder = defaultValue;
    so.rmempty = false;
    so.render = function (option_index, section_id, in_table) {
      var el = form.Value.prototype.render.apply(this, [
        option_index,
        section_id,
        in_table,
      ]);
      return Promise.resolve(el).then(function (element) {
        var input = element.querySelector('input[type="text"]');
        if (input) {
          var color = new Color(input.value);
          if (color.alpha < 1) {
            color.alpha = 1;
          }
          var colorInput = E("input", {
            type: "color",
            value: color.toString({ format: "hex" }),
            style:
              "margin-left: 8px; height: 2em; width: 3em; vertical-align: middle; cursor: pointer;",
            title: _("Color Picker Helper"),
            change: function (ev) {
              input.value = this.value;
            },
          });
          input.parentNode.appendChild(colorInput);
        }
        return element;
      });
    };
  }
};

return view.extend({
  load: () => uci.load("aurora"),

  render() {
    let m, s, o, ss, so;

    const gradientColorVars = [
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
    ];

    const darkGradientColorVars = [
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
    ];

    const semanticColorVars = [
      ["light_primary", "oklch(0.68 0.11 233)", _("Primary Color")],
      [
        "light_primary_text",
        "oklch(0.6656 0.1055 234.61)",
        _("Primary Text Color"),
      ],
      [
        "light_primary_hover",
        "oklch(0.64 0.1055 234.61)",
        _("Primary Hover Color"),
      ],
      ["light_muted", "oklch(0.97 0 0)", _("Muted Color")],
      ["light_muted_text", "oklch(0.35 0 0)", _("Muted Text Color")],
      ["light_muted_hover", "oklch(0.94 0 0)", _("Muted Hover Color")],
      ["light_accent", "oklch(0.62 0.22 25)", _("Accent Color")],
      ["light_accent_text", "oklch(0.97 0.02 25)", _("Accent Text Color")],
      ["light_destructive", "oklch(0.94 0.05 25)", _("Destructive Color")],
      [
        "light_destructive_text",
        "oklch(0.35 0.12 25)",
        _("Destructive Text Color"),
      ],
      [
        "light_destructive_hover",
        "oklch(0.92 0.06 25)",
        _("Destructive Hover Color"),
      ],
    ];

    const darkSemanticColorVars = [
      ["dark_primary", "oklch(0.534 0.118 190.485)", _("Primary Color")],
      [
        "dark_primary_text",
        "oklch(0.779 0.168 188.745)",
        _("Primary Text Color"),
      ],
      [
        "dark_primary_hover",
        "oklch(0.58 0.13 189.632)",
        _("Primary Hover Color"),
      ],
      ["dark_muted", "oklch(0.373 0.026 259.733)", _("Muted Color")],
      ["dark_muted_text", "oklch(0.92 0.01 259.733)", _("Muted Text Color")],
      ["dark_muted_hover", "oklch(0.395 0.026 259.733)", _("Muted Hover Color")],
      ["dark_accent", "oklch(0.35 0.12 25)", _("Accent Color")],
      ["dark_accent_text", "oklch(0.88 0.14 25)", _("Accent Text Color")],
      ["dark_destructive", "oklch(0.28 0.12 25/0.3)", _("Destructive Color")],
      [
        "dark_destructive_text",
        "oklch(0.88 0.14 25)",
        _("Destructive Text Color"),
      ],
      [
        "dark_destructive_hover",
        "oklch(0.32 0.14 25/0.4)",
        _("Destructive Hover Color"),
      ],
    ];

    const statusColorVars = [
      ["light_default", "oklch(0.97 0 0)", _("Default Color")],
      ["light_default_text", "oklch(0.205 0 0)", _("Default Text Color")],
      [
        "light_default_border",
        "oklch(0.922 0 0/0.3)",
        _("Default Border Color"),
      ],
      ["light_default_shadow", "oklch(0 0 0/0.1)", _("Default Shadow Color")],
      ["light_default_start", "oklch(0.98 0 0)", _("Default Start Color")],
      ["light_default_mid", "oklch(0.96 0 0)", _("Default Mid Color")],
      ["light_default_end", "oklch(0.98 0 0)", _("Default End Color")],
      ["light_success", "oklch(0.94 0.05 160)", _("Success Color")],
      ["light_success_text", "oklch(0.32 0.09 165)", _("Success Text Color")],
      [
        "light_success_border",
        "oklch(0.65 0.17 165/0.4)",
        _("Success Border Color"),
      ],
      [
        "light_success_shadow",
        "oklch(0.65 0.17 165/0.1)",
        _("Success Shadow Color"),
      ],
      ["light_success_start", "oklch(0.97 0.02 160)", _("Success Start Color")],
      ["light_success_mid", "oklch(0.94 0.05 160)", _("Success Mid Color")],
      ["light_success_end", "oklch(0.97 0.02 160)", _("Success End Color")],
      ["light_info", "oklch(0.94 0.05 230)", _("Info Color")],
      ["light_info_text", "oklch(0.35 0.08 240)", _("Info Text Color")],
      ["light_info_border", "oklch(0.62 0.19 240/0.4)", _("Info Border Color")],
      ["light_info_shadow", "oklch(0.62 0.19 240/0.1)", _("Info Shadow Color")],
      ["light_info_start", "oklch(0.97 0.02 230)", _("Info Start Color")],
      ["light_info_mid", "oklch(0.94 0.05 230)", _("Info Mid Color")],
      ["light_info_end", "oklch(0.97 0.02 230)", _("Info End Color")],
      ["light_warning", "oklch(0.95 0.05 90)", _("Warning Color")],
      ["light_warning_text", "oklch(0.35 0.08 60)", _("Warning Text Color")],
      [
        "light_warning_border",
        "oklch(0.68 0.18 75/0.4)",
        _("Warning Border Color"),
      ],
      [
        "light_warning_shadow",
        "oklch(0.68 0.18 75/0.1)",
        _("Warning Shadow Color"),
      ],
      ["light_warning_start", "oklch(0.98 0.02 90)", _("Warning Start Color")],
      ["light_warning_mid", "oklch(0.95 0.05 90)", _("Warning Mid Color")],
      ["light_warning_end", "oklch(0.98 0.02 90)", _("Warning End Color")],
      ["light_error", "oklch(0.94 0.05 25)", _("Error Color")],
      ["light_error_text", "oklch(0.35 0.12 25)", _("Error Text Color")],
      [
        "light_error_border",
        "oklch(0.62 0.22 25/0.3)",
        _("Error Border Color"),
      ],
      ["light_error_ring", "oklch(0.62 0.22 25/0.4)", _("Error Ring Color")],
      [
        "light_error_shadow",
        "oklch(0.62 0.22 25/0.1)",
        _("Error Shadow Color"),
      ],
      ["light_error_start", "oklch(0.97 0.02 25)", _("Error Start Color")],
      ["light_error_mid", "oklch(0.94 0.05 25)", _("Error Mid Color")],
      ["light_error_end", "oklch(0.97 0.02 25)", _("Error End Color")],
    ];

    const darkStatusColorVars = [
      ["dark_default", "oklch(0.372 0.044 257.287)", _("Default Color")],
      ["dark_default_text", "oklch(0.985 0.01 257.287)", _("Default Text Color")],
      [
        "dark_default_border",
        "oklch(0.39 0.044 257.287/0.3)",
        _("Default Border Color"),
      ],
      ["dark_default_shadow", "oklch(0 0 0/0.3)", _("Default Shadow Color")],
      ["dark_default_start", "oklch(0.39 0.044 257.287/0.8)", _("Default Start Color")],
      ["dark_default_mid", "oklch(0.355 0.044 257.287/0.6)", _("Default Mid Color")],
      ["dark_default_end", "oklch(0.39 0.044 257.287/0.8)", _("Default End Color")],
      ["dark_success", "oklch(0.28 0.09 165/0.3)", _("Success Color")],
      ["dark_success_text", "oklch(0.92 0.09 160)", _("Success Text Color")],
      [
        "dark_success_border",
        "oklch(0.65 0.17 165/0.3)",
        _("Success Border Color"),
      ],
      [
        "dark_success_shadow",
        "oklch(0.65 0.17 165/0.1)",
        _("Success Shadow Color"),
      ],
      [
        "dark_success_start",
        "oklch(0.32 0.09 165/0.4)",
        _("Success Start Color"),
      ],
      ["dark_success_mid", "oklch(0.28 0.09 165/0.3)", _("Success Mid Color")],
      ["dark_success_end", "oklch(0.32 0.09 165/0.4)", _("Success End Color")],
      ["dark_info", "oklch(0.28 0.08 240/0.3)", _("Info Color")],
      ["dark_info_text", "oklch(0.88 0.06 230)", _("Info Text Color")],
      ["dark_info_border", "oklch(0.62 0.19 240/0.3)", _("Info Border Color")],
      ["dark_info_shadow", "oklch(0.62 0.19 240/0.1)", _("Info Shadow Color")],
      ["dark_info_start", "oklch(0.35 0.08 240/0.4)", _("Info Start Color")],
      ["dark_info_mid", "oklch(0.28 0.08 240/0.3)", _("Info Mid Color")],
      ["dark_info_end", "oklch(0.35 0.08 240/0.4)", _("Info End Color")],
      ["dark_warning", "oklch(0.28 0.08 60/0.3)", _("Warning Color")],
      ["dark_warning_text", "oklch(0.9 0.12 90)", _("Warning Text Color")],
      [
        "dark_warning_border",
        "oklch(0.68 0.18 75/0.3)",
        _("Warning Border Color"),
      ],
      [
        "dark_warning_shadow",
        "oklch(0.68 0.18 75/0.1)",
        _("Warning Shadow Color"),
      ],
      [
        "dark_warning_start",
        "oklch(0.35 0.08 60/0.4)",
        _("Warning Start Color"),
      ],
      ["dark_warning_mid", "oklch(0.28 0.08 60/0.3)", _("Warning Mid Color")],
      ["dark_warning_end", "oklch(0.35 0.08 60/0.4)", _("Warning End Color")],
      ["dark_error", "oklch(0.28 0.12 25/0.3)", _("Error Color")],
      ["dark_error_text", "oklch(0.88 0.14 25)", _("Error Text Color")],
      ["dark_error_border", "oklch(0.62 0.22 25/0.3)", _("Error Border Color")],
      ["dark_error_ring", "oklch(0.62 0.22 25/0.4)", _("Error Ring Color")],
      ["dark_error_shadow", "oklch(0.62 0.22 25/0.1)", _("Error Shadow Color")],
      ["dark_error_start", "oklch(0.35 0.12 25/0.4)", _("Error Start Color")],
      ["dark_error_mid", "oklch(0.28 0.12 25/0.3)", _("Error Mid Color")],
      ["dark_error_end", "oklch(0.35 0.12 25/0.4)", _("Error End Color")],
    ];

    const structureVars = [
      ["struct_font_sans", '"Lato", ui-sans-serif, system-ui, sans-serif'],
      [
        "struct_font_mono",
        'ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace',
      ],
      ["struct_spacing", "0.25rem"],
    ];

    m = new form.Map("aurora", _("Aurora Configuration"));

    s = m.section(form.NamedSection, "theme", "aurora");

    s.tab("colors", _("Color"));
    s.tab("structure", _("Structure"));

    o = s.taboption(
      "colors",
      form.SectionValue,
      "_colors",
      form.NamedSection,
      "theme",
      "aurora"
    );
    ss = o.subsection;

    ss.tab("light", _("Light Mode"));
    ss.tab("dark", _("Dark Mode"));

    const lightGradientTitle = ss.taboption("light", form.DummyValue, "", "");
    lightGradientTitle.rawhtml = true;
    lightGradientTitle.default = createSectionTitle(_("Gradient Colors"));

    addColorInputs(ss, "light", gradientColorVars, "light");

    const lightSemanticTitle = ss.taboption("light", form.DummyValue, "", "");
    lightSemanticTitle.rawhtml = true;
    lightSemanticTitle.default = createSectionTitle(_("Semantic Colors"));

    addColorInputs(ss, "light", semanticColorVars, "light");

    const lightStatusTitle = ss.taboption("light", form.DummyValue, "", "");
    lightStatusTitle.rawhtml = true;
    lightStatusTitle.default = createSectionTitle(_("Status Colors"));

    addColorInputs(ss, "light", statusColorVars, "light");

    const darkGradientTitle = ss.taboption("dark", form.DummyValue, "", "");
    darkGradientTitle.rawhtml = true;
    darkGradientTitle.default = createSectionTitle(_("Gradient Colors"));

    addColorInputs(ss, "dark", darkGradientColorVars, "dark");

    const darkSemanticTitle = ss.taboption("dark", form.DummyValue, "", "");
    darkSemanticTitle.rawhtml = true;
    darkSemanticTitle.default = createSectionTitle(_("Semantic Colors"));

    addColorInputs(ss, "dark", darkSemanticColorVars, "dark");

    const darkStatusTitle = ss.taboption("dark", form.DummyValue, "", "");
    darkStatusTitle.rawhtml = true;
    darkStatusTitle.default = createSectionTitle(_("Status Colors"));

    addColorInputs(ss, "dark", darkStatusColorVars, "dark");

    o = s.taboption(
      "structure",
      form.SectionValue,
      "_structure",
      form.NamedSection,
      "theme",
      "aurora"
    );
    ss = o.subsection;

    const layoutTitle = ss.option(form.DummyValue, "", "");
    layoutTitle.rawhtml = true;
    layoutTitle.default = createSectionTitle(_("Layout"));

    so = ss.option(
      form.ListValue,
      "nav_submenu_type",
      _("Navigation Submenu Type")
    );
    so.value("mega-menu", _("Mega Menu"));
    so.value("boxed-dropdown", _("Boxed Dropdown"));
    so.default = "mega-menu";
    so.rmempty = false;

    so = ss.option(form.Value, "struct_spacing", _("Spacing"));
    so.default = structureVars[2][1];
    so.placeholder = structureVars[2][1];
    so.rmempty = false;
    so.render = function (option_index, section_id, in_table) {
      var self = this;
      var el = form.Value.prototype.render.apply(this, [
        option_index,
        section_id,
        in_table,
      ]);
      return Promise.resolve(el).then(function (element) {
        var input = element.querySelector("input");
        if (input) {
          input.type = "hidden";
          var value = input.value || self.default;
          var numValue = parseFloat(value) || 0.25;
          var valueDisplay = E(
            "span",
            {
              style:
                "margin-left: 10px; min-width: 60px; display: inline-block;",
            },
            numValue.toFixed(2) + "rem"
          );
          var rangeInput = E("input", {
            type: "range",
            min: "-0.1",
            max: "0.5",
            step: "0.05",
            value: numValue,
            style: "width: 200px; vertical-align: middle;",
            input: function (ev) {
              var val = parseFloat(this.value).toFixed(2) + "rem";
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

    return m.render();
  },
});
