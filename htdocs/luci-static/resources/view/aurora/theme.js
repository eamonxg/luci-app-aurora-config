"use strict";
"require view";
"require form";
"require uci";
"require rpc";
"require ui";
"require fs";
"require utils.version-api";

const CONFIG_IMPORT_PATH = "/tmp/aurora_config_import.tmp";

const loadGlobalScript = (src) =>
  new Promise((resolve, reject) => {
    const script = E("script", {
      type: "text/javascript",
      src: L.resource(src),
    });
    script.addEventListener("load", resolve, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error(_("Unable to load %s.").format(src))),
      { once: true },
    );
    document.querySelector("head").appendChild(script);
  });

// color.global.js (colorjs.io) powers swatch conversion; tokens.global.js is the
// shared derivation engine (mirrors the theme's tokens/spec.js) used to expand
// the 10 editable inputs into the full set of stored/derived colour tokens.
const colorLibraryReady = (async () => {
  if (typeof Color !== "function")
    await loadGlobalScript("utils/color.global.js");
  if (typeof AuroraTokens === "undefined")
    await loadGlobalScript("utils/tokens.global.js");
})();

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

const callGetThemePreset = rpc.declare({
  object: "luci.aurora",
  method: "get_theme_preset",
  params: ["name"],
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

const COLOR_TOKENS = [
  {
    key: "bg",
    label: _("Background"),
    description: _("The outer application background."),
    layer: 1,
    group: "foundation",
  },
  {
    key: "surface",
    label: _("Surface"),
    description: _("Cards, panels, forms, and page content background."),
    layer: 1,
    group: "foundation",
  },
  {
    key: "text",
    label: _("Text"),
    description: _("The primary text and icon color."),
    layer: 1,
    group: "identity",
  },
  {
    key: "brand",
    label: _("Brand"),
    description: _("The main interactive and branded accent."),
    layer: 1,
    group: "identity",
  },
  {
    key: "on_brand",
    label: _("Content on Brand"),
    description: _("Text and icons shown on the brand color."),
    layer: 1,
    group: "identity",
  },
  {
    key: "link",
    label: _("Link"),
    description: _("Text links and link-like actions."),
    layer: 1,
    group: "identity",
  },
  {
    key: "info",
    label: _("Info Accent"),
    description: _("The accent used for informational feedback."),
    layer: 1,
    group: "status",
  },
  {
    key: "warning",
    label: _("Warning Accent"),
    description: _("The accent used for warning feedback."),
    layer: 1,
    group: "status",
  },
  {
    key: "success",
    label: _("Success Accent"),
    description: _("The accent used for successful feedback."),
    layer: 1,
    group: "status",
  },
  {
    key: "danger",
    label: _("Danger Accent"),
    description: _("The accent used for errors and destructive actions."),
    layer: 1,
    group: "status",
  },
];

const COLOR_GROUPS = [
  {
    key: "foundation",
    title: _("Surfaces"),
    description: _("Set the application background and surface colors."),
    advanced: false,
  },
  {
    key: "identity",
    title: _("Content & Identity"),
    description: _(
      "Set primary text, brand, content on brand, and link colors.",
    ),
    advanced: false,
  },
  {
    key: "status",
    title: _("Status Accents"),
    description: _("Set the broad accents used by status families."),
    advanced: false,
  },
];

const cssTokenName = (key) => key.replaceAll("_", "-");
const colorOptionName = (mode, key) => `${mode}_${key}`;

const createColorResolver = () => {
  let framePromise = null;
  let queue = Promise.resolve();

  const ensureFrame = () => {
    if (framePromise) return framePromise;

    framePromise = new Promise((resolve, reject) => {
      const iframe = document.createElement("iframe");
      iframe.setAttribute("aria-hidden", "true");
      iframe.tabIndex = -1;
      iframe.style.cssText =
        "position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;border:0;visibility:hidden;pointer-events:none;";

      const timeout = window.setTimeout(
        () => reject(new Error(_("Theme stylesheet resolver timed out."))),
        10000,
      );

      iframe.addEventListener(
        "load",
        () => {
          const doc = iframe.contentDocument;
          const link = doc?.querySelector('link[rel="stylesheet"]');
          const finish = () => {
            window.clearTimeout(timeout);
            const probe = doc.createElement("span");
            probe.style.cssText =
              "position:absolute;left:-9999px;top:-9999px;visibility:hidden;";
            doc.body.appendChild(probe);
            resolve({ iframe, doc, root: doc.documentElement, probe });
          };

          if (!doc || !link) {
            window.clearTimeout(timeout);
            reject(new Error(_("Unable to create the theme color resolver.")));
          } else if (link.sheet) {
            finish();
          } else {
            link.addEventListener("load", finish, { once: true });
            link.addEventListener(
              "error",
              () => {
                window.clearTimeout(timeout);
                reject(new Error(_("Unable to load the Aurora stylesheet.")));
              },
              { once: true },
            );
          }
        },
        { once: true },
      );

      iframe.srcdoc =
        '<!doctype html><html><head><link rel="stylesheet" href="/luci-static/aurora/main.css"></head><body></body></html>';
      (document.body || document.documentElement).appendChild(iframe);
    });

    return framePromise;
  };

  const resolveMode = (mode, values) => {
    queue = queue.catch(() => {}).then(async () => {
      const { root, probe } = await ensureFrame();
      root.setAttribute("data-darkmode", mode === "dark" ? "true" : "false");

      COLOR_TOKENS.forEach(({ key }) => {
        root.style.removeProperty(`--${cssTokenName(key)}`);
      });
      COLOR_TOKENS.forEach(({ key }) => {
        const value = values[key]?.trim();
        if (value) root.style.setProperty(`--${cssTokenName(key)}`, value);
      });

      const results = new Map();
      COLOR_TOKENS.forEach(({ key }) => {
        const name = cssTokenName(key);
        probe.parentElement.style.color = "rgb(1 2 3)";
        probe.style.color = `var(--${name}, rgb(1 2 3))`;
        const first = getComputedStyle(probe).color;
        probe.parentElement.style.color = "rgb(4 5 6)";
        probe.style.color = `var(--${name}, rgb(4 5 6))`;
        const second = getComputedStyle(probe).color;

        if (!first || !second || first !== second) {
          results.set(key, {
            valid: false,
            error: _("Invalid, missing, or cyclic color expression."),
          });
        } else {
          results.set(key, { valid: true, color: first });
        }
      });
      probe.parentElement.style.removeProperty("color");
      return results;
    });

    return queue;
  };

  const destroy = () => {
    framePromise?.then(({ iframe }) => iframe.remove()).catch(() => {});
    framePromise = null;
  };

  return { resolveMode, destroy };
};

const createColorEditor = (themeConfig, presetColors) => {
  const resolver = createColorResolver();
  const fields = { light: new Map(), dark: new Map() };
  const states = { light: new Map(), dark: new Map() };
  const timers = { light: null, dark: null };
  const previewOriginal = new Map();
  let modeObserver = null;

  const currentMode = () =>
    document.documentElement.getAttribute("data-darkmode") === "true"
      ? "dark"
      : "light";

  const stateFor = (mode, key) => {
    if (!states[mode].has(key)) {
      states[mode].set(key, { pending: true, valid: false, error: null });
    }
    return states[mode].get(key);
  };

  const valueFor = (mode, key) => {
    const field = fields[mode].get(key);
    if (field?.input) return field.input.value;
    return themeConfig[colorOptionName(mode, key)] || "";
  };

  const valuesForMode = (mode) =>
    Object.fromEntries(
      COLOR_TOKENS.map(({ key }) => [key, valueFor(mode, key)]),
    );

  // Expand the 10 editable inputs into the full resolved token set (inputs +
  // derived) via the shared engine. Returns null if the engine is not loaded
  // yet or any input is blank, so callers fall back to the baked theme values.
  const resolvedForMode = (mode) => {
    if (typeof AuroraTokens === "undefined") return null;
    const inputs = {};
    for (const { key } of COLOR_TOKENS) {
      const value = valueFor(mode, key).trim();
      if (!value) return null;
      inputs[key] = value;
    }
    try {
      return AuroraTokens.resolve(mode, inputs);
    } catch (_error) {
      return null;
    }
  };

  const isInputToken = (key) => COLOR_TOKENS.some((token) => token.key === key);

  const rememberPreview = (property) => {
    if (previewOriginal.has(property)) return;
    previewOriginal.set(property, {
      value: document.documentElement.style.getPropertyValue(property),
      priority: document.documentElement.style.getPropertyPriority(property),
    });
  };

  const restorePreviewProperty = (property) => {
    const original = previewOriginal.get(property);
    if (!original) {
      document.documentElement.style.removeProperty(property);
    } else if (original.value) {
      document.documentElement.style.setProperty(
        property,
        original.value,
        original.priority,
      );
    } else {
      document.documentElement.style.removeProperty(property);
    }
  };

  const cleanupPreview = () => {
    previewOriginal.forEach((_original, property) => {
      restorePreviewProperty(property);
    });
    previewOriginal.clear();
  };

  const applyPreview = (mode) => {
    if (mode !== currentMode()) return;

    COLOR_TOKENS.forEach(({ key }) => {
      const state = stateFor(mode, key);
      if (!state.valid) return;

      const property = `--${cssTokenName(key)}`;
      const value = valueFor(mode, key).trim();
      rememberPreview(property);
      if (value) {
        document.documentElement.style.setProperty(property, value);
      } else {
        restorePreviewProperty(property);
      }
    });

    // Derived tokens are baked literals in the theme stylesheet, so changing an
    // input no longer cascades on its own -- recompute and preview them too.
    const resolved = resolvedForMode(mode);
    if (resolved) {
      Object.keys(resolved).forEach((key) => {
        if (isInputToken(key)) return;
        const property = `--${cssTokenName(key)}`;
        rememberPreview(property);
        document.documentElement.style.setProperty(property, resolved[key]);
      });
    }
  };

  const triggerValidation = (field) => {
    field?.option.triggerValidation(field.sectionId);
  };

  const refreshTabErrors = (mode) => {
    const field = fields[mode].values().next().value;
    const mapRoot = field?.option?.map?.root;
    if (mapRoot) ui.tabs.updateTabs(null, mapRoot);
  };

  const updateField = (mode, key, result) => {
    const field = fields[mode].get(key);
    const state = stateFor(mode, key);
    state.pending = false;
    state.valid = Boolean(result?.valid);
    state.error = result?.error || null;
    if (!field) return;

    field.input.setCustomValidity(state.valid ? "" : state.error);
    field.element.classList.toggle("cbi-value-error", !state.valid);

    if (!state.valid) {
      field.status.textContent = state.error;
      triggerValidation(field);
      return;
    }

    try {
      const color = new Color(result.color);
      if (color.alpha < 1) color.alpha = 1;
      const hex = color.to("srgb").toString({ format: "hex" });
      field.picker.value = hex;
      field.swatch.style.backgroundColor = result.color;
      field.swatch.title = `${_("Resolved color")}: ${result.color}`;
      if (field.token.layer === 1) {
        field.status.textContent = "";
        triggerValidation(field);
        return;
      }
      const expression = field.input.value.trim();
      const dependencies = Array.from(
        expression.matchAll(/--([a-z0-9-]+)/g),
        (match) => match[1],
      );
      field.status.textContent = expression
        ? dependencies.length
          ? _("Formula: %s").format(dependencies.join(", "))
          : _("Literal")
        : _("Following theme stylesheet");
    } catch (error) {
      state.valid = false;
      state.error = _("Resolved color cannot be shown by the picker.");
      field.input.setCustomValidity(state.error);
      field.element.classList.add("cbi-value-error");
      field.status.textContent = state.error;
    }
    triggerValidation(field);
  };

  const refresh = (mode) =>
    resolver
      .resolveMode(mode, valuesForMode(mode))
      .then((results) => colorLibraryReady.then(() => results))
      .then((results) => {
        COLOR_TOKENS.forEach(({ key }) => {
          updateField(mode, key, results.get(key));
        });
        applyPreview(mode);
      })
      .catch((error) => {
        COLOR_TOKENS.forEach(({ key }) => {
          updateField(mode, key, {
            valid: false,
            error: error?.message || _("Unable to resolve color expressions."),
          });
        });
      })
      .finally(() => refreshTabErrors(mode));

  const schedule = (mode) => {
    window.clearTimeout(timers[mode]);
    COLOR_TOKENS.forEach(({ key }) => {
      const state = stateFor(mode, key);
      state.pending = true;
    });
    timers[mode] = window.setTimeout(() => refresh(mode), 120);
  };

  const register = (
    mode,
    token,
    element,
    input,
    option,
    sectionId,
    controls,
  ) => {
    fields[mode].set(token.key, {
      element,
      input,
      option,
      sectionId,
      token,
      ...controls,
    });
    input.addEventListener("input", () => {
      themeConfig[colorOptionName(mode, token.key)] = input.value;
      schedule(mode);
    });
    schedule(mode);
  };

  const validate = (mode, key, value) => {
    if (!value?.trim()) return true;
    const state = stateFor(mode, key);
    if (state.pending) return _("Color expression is still resolving.");
    return state.valid
      ? true
      : state.error || _("Invalid color expression.");
  };

  const attach = () => {
    schedule("light");
    schedule("dark");
    modeObserver = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.attributeName === "data-darkmode")) {
        cleanupPreview();
        applyPreview(currentMode());
      }
    });
    modeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-darkmode"],
    });
    window.addEventListener("beforeunload", cleanupPreview, { once: true });
  };

  const destroy = () => {
    window.clearTimeout(timers.light);
    window.clearTimeout(timers.dark);
    modeObserver?.disconnect();
    cleanupPreview();
    resolver.destroy();
  };

  return {
    attach,
    cleanupPreview,
    destroy,
    presetColors,
    register,
    resolvedForMode,
    schedule,
    stateFor,
    validate,
  };
};

const renderColorField = function (optionIndex, sectionId, inTable) {
  const rendered = form.Value.prototype.render.apply(this, [
    optionIndex,
    sectionId,
    inTable,
  ]);

  return Promise.resolve(rendered).then((element) => {
    const input = element.querySelector('input[type="text"]');
    if (!input) return element;

    const token = this.colorToken;
    const mode = this.colorMode;
    const editor = this.colorEditor;
    const optionKey = colorOptionName(mode, token.key);
    const presetValue = editor.presetColors?.[optionKey] || "";
    input.placeholder = presetValue || _("Follow theme stylesheet");

    const picker = E("input", {
      type: "color",
      value: "#000000",
      style:
        "position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;border:0;opacity:0;cursor:pointer;",
      title: _("Choose a literal color"),
    });
    const swatch = E(
      "span",
      {
        style:
          "position:relative;display:inline-block;width:2rem;height:2rem;margin-left:.5rem;border:1px solid currentColor;border-radius:.5rem;vertical-align:middle;background:transparent;overflow:hidden;cursor:pointer;",
        title: _("Resolved color — click to pick"),
      },
      [picker],
    );
    const status = E("small", {
      style: "display:block;margin-top:.35rem;opacity:.75;",
    });

    const controls = E("span", {}, [swatch]);
    input.parentNode.appendChild(controls);
    input.parentNode.appendChild(status);

    if (token.layer === 2) {
      const restore = E(
        "button",
        {
          type: "button",
          class: "cbi-button",
          style: "margin-left:.5rem;",
          disabled: presetValue ? null : "disabled",
          title: _("Restore the active preset expression for this token"),
          click: (event) => {
            event.preventDefault();
            if (!presetValue) return;
            input.value = presetValue;
            input.dispatchEvent(new Event("input", { bubbles: true }));
          },
        },
        _("Restore Preset Formula"),
      );
      controls.appendChild(restore);
    }

    picker.addEventListener("change", () => {
      try {
        input.value = new Color(picker.value)
          .to("oklch")
          .toString({ precision: 5 });
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (error) {
        input.setCustomValidity(_("Unable to convert the selected color."));
      }
    });

    editor.register(
      mode,
      token,
      element,
      input,
      this,
      sectionId,
      {
        picker,
        status,
        swatch,
      },
    );
    return element;
  });
};

const addColorInputs = (section, mode, tokens, editor) => {
  tokens.forEach((token) => {
    const optionKey = colorOptionName(mode, token.key);
    const option = section.option(form.Value, optionKey, token.label);
    option.rmempty = true;
    if (token.description) option.description = token.description;
    option.colorEditor = editor;
    option.colorMode = mode;
    option.colorToken = token;
    option.render = renderColorField;
    option.validate = (_sectionId, value) =>
      editor.validate(mode, token.key, value);
    option.write = (sectionId, value) => {
      const trimmed = value?.trim();
      if (trimmed) {
        uci.set("aurora", sectionId, optionKey, trimmed);
      } else {
        uci.unset("aurora", sectionId, optionKey);
      }
    };
    option.remove = (sectionId) => {
      uci.unset("aurora", sectionId, optionKey);
    };
  });
};

const createColorSections = (section, mode, editor) => {
  COLOR_GROUPS.forEach((group) => {
    const tokens = COLOR_TOKENS.filter((token) => token.group === group.key);
    const sectionValue = section.taboption(
      mode,
      form.SectionValue,
      `_${mode}_${group.key}`,
      form.NamedSection,
      "theme",
      "aurora",
      group.advanced ? "" : group.title,
      group.advanced ? "" : group.description,
    );
    if (group.advanced) {
      const baseRender = sectionValue.render.bind(sectionValue);
      sectionValue.render = (...args) =>
        Promise.resolve(baseRender(...args)).then((node) =>
          E("details", { class: "cbi-section aurora-advanced-group" }, [
            E(
              "summary",
              { style: "cursor:pointer;font-weight:600;margin:.5em 0;" },
              group.title,
            ),
            group.description
              ? E(
                  "div",
                  { style: "opacity:.75;margin:.25em 0 .5em;" },
                  group.description,
                )
              : "",
            node,
          ]),
        );
    }
    addColorInputs(sectionValue.subsection, mode, tokens, editor);
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

// Expand the 10 editable inputs into the full resolved token set and stage every
// resulting key (inputs + derived) into UCI so the saved snapshot fully overrides
// the theme's baked _tokens.css defaults. No-op until the engine is loaded and all
// inputs are present, in which case the baked theme defaults remain in effect.
const persistDerivedTokens = (editor) => {
  if (!editor) return;
  ["light", "dark"].forEach((mode) => {
    const resolved = editor.resolvedForMode(mode);
    if (!resolved) return;
    Object.keys(resolved).forEach((key) => {
      uci.set("aurora", "theme", `${mode}_${key}`, resolved[key]);
    });
  });
};

return view.extend({
  handleSave: function (ev) {
    const save = L.bind(function () {
      return colorLibraryReady
        .catch(() => {})
        .then(() => persistDerivedTokens(this.colorEditor))
        .then(() => this.super("handleSave", [ev]));
    }, this);
    const writePwa = () => L.resolveDefault(callWritePwaManifest(), {});
    const cleanup = () => this.colorEditor?.cleanupPreview();
    const handleFailure = (error) => {
      cleanup();
      throw error;
    };

    if (typeof this.prepareAuroraFonts === "function") {
      return this.prepareAuroraFonts()
        .then(save)
        .then(writePwa)
        .then(cleanup)
        .catch(handleFailure);
    }
    return save().then(writePwa).then(cleanup).catch(handleFailure);
  },

  handleSaveApply: function (ev, mode) {
    const save = L.bind(function () {
      return colorLibraryReady
        .catch(() => {})
        .then(() => persistDerivedTokens(this.colorEditor))
        .then(() => this.super("handleSave", [ev]));
    }, this);
    const writePwa = () => L.resolveDefault(callWritePwaManifest(), {});
    const cleanup = () => this.colorEditor?.cleanupPreview();
    const apply = () => {
      cleanup();
      ui.changes.apply(mode === "0");
    };
    const handleFailure = (error) => {
      cleanup();
      throw error;
    };

    if (typeof this.prepareAuroraFonts === "function") {
      return this.prepareAuroraFonts()
        .then(save)
        .then(writePwa)
        .then(apply)
        .catch(handleFailure);
    }
    return save().then(writePwa).then(apply).catch(handleFailure);
  },

  handleReset: function (ev) {
    this.colorEditor?.cleanupPreview();
    return this.super("handleReset", [ev]).then(() => {
      this.colorEditor?.schedule("light");
      this.colorEditor?.schedule("dark");
    });
  },

  load: function () {
    return Promise.all([
      uci.load("aurora"),
      L.resolveDefault(callGetThemeConfig(), {}),
      L.resolveDefault(utils_version_api.callGetInstalledVersions(), {}),
      L.resolveDefault(callGetFontPresets(), {}),
      getIconsOnce(),
    ]).then((loadData) => {
      const activePreset = loadData[1]?.theme?.active_preset || "classic";
      return L.resolveDefault(callGetThemePreset(activePreset), {
        result: -1,
        colors: {},
      }).then((preset) => loadData.concat(preset));
    });
  },

  render(loadData) {
    const themeConfig = loadData[1]?.theme || {};
    const installedVersions = loadData[2];
    const fontPresetsBySlot = loadData[3]?.fonts || {};
    const presetColors = loadData[5]?.colors || {};
    this.colorEditor?.destroy();
    const colorEditor = createColorEditor(themeConfig, presetColors);
    this.colorEditor = colorEditor;

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
      const initialPreset = presetOptions.some((p) => p.name === uciPreset)
        ? uciPreset
        : "classic";

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

      const resolvePresetSelection = () => {
        const presetName = select.value || "classic";
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
                  "Applying '%s' replaces all light and dark color values. Layout, branding, fonts, assets, navigation, login background, and toolbar settings are preserved. Continue?",
                ).format(presetLabel),
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
                          colorEditor.cleanupPreview();
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

    createColorSections(colorSubsection, "light", colorEditor);
    createColorSections(colorSubsection, "dark", colorEditor);

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
    so.value("sidebar", _("Sidebar"));
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
            "height:100%;width:0%;transition:width 0.15s;border-radius:2px;background:var(--brand);",
        });
        const progressFilename = E("span", {}, "");
        const progressPct = E("span", {}, "0%");
        const progressRow = E(
          "div",
          {
            style:
              "display:none;margin-bottom:0.75em;padding:0.6em 0.875em;border-radius:0.375em;border:1px solid var(--border-subtle);",
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
                  "height:4px;border-radius:2px;overflow:hidden;background:var(--progress-track-bg);",
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
              "border:2px dashed var(--border-strong);border-radius:0.5em;padding:1.25em 1em;text-align:center;cursor:pointer;margin-bottom:0.75em;transition:border-color 0.15s,background 0.15s;",
            click: () => fileInput.click(),
            dragover: (e) => {
              e.preventDefault();
              dropzone.style.borderColor = "var(--brand)";
              dropzone.style.background = "var(--brand-faint)";
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
              "width:40px;height:40px;border-radius:4px;background:var(--surface-subtle);",
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
        uci.unset("aurora", section_id, "struct_login_bg_lqip");
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
                '[name="cbid.aurora.theme.struct_login_bg_lqip"]',
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

    const lqipSo = logoSubsection.option(
      form.Value,
      "struct_login_bg_lqip",
      "",
    );
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
      colorEditor.attach();

      const updateVersionLabel = (label, hasUpdate) => {
        if (!label || !hasUpdate) return;

        label.className = "label warning";
        Object.assign(label.style, {
          position: "relative",
          paddingRight: "16px",
        });
        const redDot = document.createElement("span");
        redDot.style.cssText =
          "position: absolute; top: 3px; right: 4px; width: 6px; height: 6px; background: var(--danger); border-radius: 50%;";
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
          '[name="cbid.aurora.theme.struct_login_bg_lqip"]',
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
