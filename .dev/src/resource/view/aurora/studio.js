"use strict";
"require view";
"require form";
"require uci";
"require rpc";
"require ui";
"require fs";
"require utils.asset-upload as assetUpload";
"require utils.feed-check as feedCheck";

const CONFIG_IMPORT_PATH = "/tmp/aurora_config_import.tmp";

const FEED_HOST = "openwrt.eamonxg.fun";
const MANIFEST_URL = `https://${FEED_HOST}/manifest.json`;
const MANIFEST_CACHE_KEY = "aurora.manifest";
const FEED_NOTICE_KEY = "aurora.feed_notice_dismissed";

// Version of the vendored @eamonxg/luci-theme-tokens engine -- stamped by
// scripts/sync-tokens.mjs, verified by tests/theme-token-sync.test.mjs.
// Appended as ?v= when loading utils/tokens.global.js so the browser never
// pairs this file with an HTTP-cached engine from a previous release.
const TOKENS_ENGINE_VERSION = "2.0.0";

const loadGlobalScript = (src, version) =>
  new Promise((resolve, reject) => {
    const script = E("script", {
      type: "text/javascript",
      src: L.resource(src) + (version ? "?v=" + version : ""),
    });
    // A dynamically inserted script is async by default, which would let
    // tokens.global.js evaluate before color.global.js has defined Color.
    // async=false puts both into the browser's in-order queue instead: they
    // download in parallel and execute in insertion order.
    script.async = false;
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
// Both are requested before either is awaited. The engine is 65KB with no gzip
// in front of it, so waiting for it to arrive before even asking for the 4KB
// file that follows costs a whole extra round trip on the settings page.
// Content hash of the vendored colour library, substituted by
// scripts/build-js.mjs. The library is vendored by hand and carries no version
// of its own, and without a ?v= a browser that already has it will never ask
// again: uhttpd dates our installed files at the epoch and sends no
// Cache-Control, so its heuristic freshness runs to years. Re-vendoring a
// newer colorjs would then reach nobody, and the two halves of the colour
// pipeline -- this library in the browser, the same one in the tokens package
// at build time -- would quietly disagree about what a hex value is.
const COLOR_LIBRARY_VERSION = "__ASSET_HASH(utils/color.global.js)__";

const colorLibraryReady = (async () => {
  const pending = [];
  if (typeof Color !== "function")
    pending.push(
      loadGlobalScript("utils/color.global.js", COLOR_LIBRARY_VERSION),
    );
  if (typeof AuroraTokens === "undefined")
    pending.push(
      loadGlobalScript("utils/tokens.global.js", TOKENS_ENGINE_VERSION),
    );
  await Promise.all(pending);
})().then(() => buildColorTokenTables());

const callUploadIcon = rpc.declare({
  object: "luci.aurora",
  method: "upload_icon",
  params: ["filename"],
});

const callListIcons = rpc.declare({
  object: "luci.aurora",
  method: "list_icons",
});

const callGetInitData = rpc.declare({
  object: "luci.aurora",
  method: "get_init_data",
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

const callPrepareFont = rpc.declare({
  object: "luci.aurora",
  method: "prepare_font",
  params: ["sans", "mono", "sans_stack"],
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

const callUploadFont = rpc.declare({
  object: "luci.aurora",
  method: "upload_font",
  params: ["slot", "family"],
});

const callRemoveFont = rpc.declare({
  object: "luci.aurora",
  method: "remove_font",
  params: ["slot", "name"],
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

// The only rpcd method this feature adds, and it fires solely when the user
// confirms the dialog. Feed status itself rides along on get_init_data.
const callAddFeed = rpc.declare({
  object: "luci.aurora",
  method: "add_feed",
});

const callWritePwaManifest = rpc.declare({
  object: "luci.aurora",
  method: "write_pwa_manifest",
});

// UI copy for each token, keyed by token name. Which tokens exist, their
// order, and the input/derived split all come from the AuroraTokens registry
// (generated from the theme's token spec); buildColorTokenTables() below joins
// the two and throws on any mismatch, so a spec change that adds or removes a
// token fails loudly here until this map is updated.
const COLOR_TOKEN_METADATA = {
  bg: {
    label: _("Background"),
    description: _(
      "Page canvas behind the header, navigation, content, and login screen.",
    ),
    group: "foundation",
  },
  surface: {
    label: _("Surface"),
    description: _(
      "Base surface for panels, cards, forms, tables, and neutral controls.",
    ),
    group: "foundation",
  },
  text: {
    label: _("Text"),
    description: _(
      "Default foreground for headings, body text, icons, and form values.",
    ),
    group: "identity",
  },
  brand: {
    label: _("Brand"),
    description: _(
      "Accent for primary buttons, active navigation, and selected states.",
    ),
    group: "identity",
  },
  on_brand: {
    label: _("On-Brand Text"),
    description: _("Text and icons shown on filled brand backgrounds."),
    group: "identity",
  },
  link: {
    label: _("Link"),
    description: _("Hyperlinks in page content, help text, and status output."),
    group: "identity",
  },
  info: {
    label: _("Info"),
    description: _("Accent for informational alerts, labels, and tooltips."),
    group: "status",
  },
  warning: {
    label: _("Warning"),
    description: _("Accent for warnings, notices, and validation messages."),
    group: "status",
  },
  success: {
    label: _("Success"),
    description: _("Accent for successful operations and healthy status."),
    group: "status",
  },
  danger: {
    label: _("Danger"),
    description: _(
      "Accent for errors, destructive controls, and critical states.",
    ),
    group: "status",
  },
};

const DERIVED_COLOR_TOKEN_METADATA = {
  text_muted: {
    label: _("Muted Text"),
    description: _(
      "Medium-emphasis text for helper copy, metadata, and summaries.",
    ),
    group: "hierarchy",
  },
  text_subtle: {
    label: _("Subtle Text"),
    description: _(
      "Low-emphasis text for small labels, placeholders, and disabled hints.",
    ),
    group: "hierarchy",
  },
  surface_sunken: {
    label: _("Sunken Surface"),
    description: _(
      "Inset layer for inputs, code blocks, table headers, and badges.",
    ),
    group: "hierarchy",
  },
  surface_overlay: {
    label: _("Overlay Surface"),
    description: _("Raised layer for dropdowns, modals, and tooltips."),
    group: "hierarchy",
  },
  control_bg: {
    label: _("Control Fill"),
    description: _(
      "Fill for form controls: inputs, selects, textareas, and checkboxes.",
    ),
    group: "hierarchy",
  },
  hairline: {
    label: _("Hairline"),
    description: _("Separators, dividers, and input or card borders."),
    group: "hierarchy",
  },
  hover_faint: {
    label: _("Faint Hover"),
    description: _(
      "Hover fill for menu items, table rows, and neutral controls.",
    ),
    group: "hierarchy",
  },
  brand_hover: {
    label: _("Brand Hover"),
    description: _(
      "Hover state for filled primary buttons and high-emphasis controls.",
    ),
    group: "brand_interaction",
  },
  brand_subtle: {
    label: _("Subtle Brand"),
    description: _(
      "Brand-tinted surface for active navigation and selected states.",
    ),
    group: "brand_interaction",
  },
  brand_subtle_hover: {
    label: _("Subtle Brand Hover"),
    description: _(
      "Hover fill for subtle primary buttons and selected surfaces.",
    ),
    group: "brand_interaction",
  },
  focus_ring: {
    label: _("Focus Ring"),
    description: _(
      "Focus outline for inputs, selects, and keyboard-operated controls.",
    ),
    group: "brand_interaction",
  },
  progress_start: {
    label: _("Progress Start"),
    description: _("Leading color for progress meters."),
    group: "brand_interaction",
  },
  progress_end: {
    label: _("Progress End"),
    description: _("Trailing color for progress meters."),
    group: "brand_interaction",
  },
  info_surface: {
    label: _("Info Surface"),
    description: _(
      "Background for informational alerts, labels, and tooltips.",
    ),
    group: "status_surfaces",
  },
  warning_surface: {
    label: _("Warning Surface"),
    description: _("Background for warning alerts, notices, and labels."),
    group: "status_surfaces",
  },
  success_surface: {
    label: _("Success Surface"),
    description: _("Background for success alerts and healthy-state labels."),
    group: "status_surfaces",
  },
  danger_surface: {
    label: _("Danger Surface"),
    description: _(
      "Background for error alerts and destructive-action messages.",
    ),
    group: "status_surfaces",
  },
  danger_surface_hover: {
    label: _("Danger Surface Hover"),
    description: _("Hover fill for quiet destructive and delete controls."),
    group: "status_surfaces",
  },
  scrim: {
    label: _("Scrim"),
    description: _("Dimming backdrop behind modal dialogs."),
    group: "hierarchy",
  },
  mega_menu_bg: {
    label: _("Mega Menu Background"),
    description: _("Opaque surface for the expanded mega menu and its header."),
    group: "hierarchy",
  },
  mega_menu_scrim: {
    label: _("Mega Menu Scrim"),
    description: _("Light backdrop behind the expanded mega menu."),
    group: "hierarchy",
  },
};

const COLOR_GROUPS = [
  {
    key: "foundation",
    title: _("System Surfaces"),
    description: _("Canvas and panel surfaces that frame the interface."),
  },
  {
    key: "identity",
    title: _("Text, Links & Brand"),
    description: _(
      "Foregrounds, hyperlinks, the brand color, and its contrast text.",
    ),
  },
  {
    key: "status",
    title: _("Operational Status Accents"),
    description: _(
      "Accents for notifications, validation, and status feedback.",
    ),
  },
];

const DERIVED_COLOR_GROUPS = [
  {
    key: "brand_interaction",
    title: _("Brand Interaction Details"),
    description: _(
      "Derived from the brand color: hover states, subtle fills, focus rings, and progress meters.",
    ),
  },
  {
    key: "hierarchy",
    title: _("Interface Hierarchy"),
    description: _(
      "Derived from the canvas, surface, and text colors: muted and subtle text, borders, overlays, and menu layers.",
    ),
  },
  {
    key: "status_surfaces",
    title: _("Status Message Surfaces"),
    description: _(
      "Derived from the status accents: alert, label, and badge backgrounds.",
    ),
  },
];

// Ordered token tables, joined from the AuroraTokens registry and the UI
// metadata above once the engine scripts have loaded (colorLibraryReady).
// Empty until then; load() awaits colorLibraryReady before building the form.
let COLOR_TOKENS = [];
let DERIVED_COLOR_TOKENS = [];
let ALL_COLOR_TOKENS = [];

const buildColorTokenTables = () => {
  const fromMetadata = (keys, metadata, extra) =>
    keys.map((key) => {
      const meta = metadata[key];
      if (!meta)
        throw new Error(`missing color token metadata for "${key}"`);
      return Object.assign({ key: key }, meta, extra);
    });
  const known = new Set(AuroraTokens.INPUTS.concat(AuroraTokens.DERIVED_KEYS));
  const stale = Object.keys(COLOR_TOKEN_METADATA)
    .concat(Object.keys(DERIVED_COLOR_TOKEN_METADATA))
    .filter((key) => !known.has(key));
  if (stale.length)
    throw new Error(`stale color token metadata: ${stale.join(", ")}`);
  COLOR_TOKENS = fromMetadata(AuroraTokens.INPUTS, COLOR_TOKEN_METADATA, {});
  DERIVED_COLOR_TOKENS = fromMetadata(
    AuroraTokens.DERIVED_KEYS,
    DERIVED_COLOR_TOKEN_METADATA,
    { derived: true },
  );
  ALL_COLOR_TOKENS = COLOR_TOKENS.concat(DERIVED_COLOR_TOKENS);
};
const COLOR_FORMAT_HELP = _(
  "Fields accept #hex, rgb(), hsl(), lab(), and oklch(). The picker fills hex; other formats can be typed.",
);

// Shown once per mode sub-tab. This used to be the description of the two
// SectionValue cards that wrapped the colour fields; with those cards gone the
// tab's own description slot is where LuCI expects this kind of preamble.
// It cannot move into the field placeholder -- renderColorField already writes
// that with the token's preset value, which is the more useful hint.
const COLOR_TAB_HINT =
  _("Changes preview here instantly; Save or Save & Apply persists them.") +
  ` ${COLOR_FORMAT_HELP}`;

const cssTokenName = (key) => key.replaceAll("_", "-");
const colorOptionName = (mode, key) => `${mode}_${key}`;

const toRuntimeColor = (value) => {
  const raw = value?.trim?.() || "";
  if (!raw || typeof Color !== "function") return raw;

  try {
    return new Color(raw).to("srgb").toString({ format: "hex" });
  } catch (_error) {
    return raw;
  }
};

const toPickerColor = (value) => {
  const color = new Color(value).to("srgb");
  color.alpha = 1;
  return color.toString({ format: "hex" });
};

const sameColorValue = (a, b) =>
  Boolean(a && b) &&
  toRuntimeColor(a).toLowerCase() === toRuntimeColor(b).toLowerCase();

const readThemeConfigFromUci = () => {
  const config = {};
  const copyOption = (option) => {
    const value = uci.get("aurora", "theme", option);
    if (value != null) config[option] = value;
  };

  copyOption("active_preset");
  copyOption("struct_font_sans");
  copyOption("struct_font_mono");
  ["light", "dark"].forEach((mode) => {
    ALL_COLOR_TOKENS.forEach(({ key }) =>
      copyOption(colorOptionName(mode, key)),
    );
  });

  return config;
};

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

  const resolveMode = (mode, values, tokens = COLOR_TOKENS) => {
    queue = queue
      .catch(() => {})
      .then(async () => {
        const { root, probe } = await ensureFrame();
        root.setAttribute("data-darkmode", mode === "dark" ? "true" : "false");

        ALL_COLOR_TOKENS.forEach(({ key }) => {
          root.style.removeProperty(`--${cssTokenName(key)}`);
        });
        ALL_COLOR_TOKENS.forEach(({ key }) => {
          const value = values[key]?.trim();
          if (value)
            root.style.setProperty(
              `--${cssTokenName(key)}`,
              toRuntimeColor(value),
            );
        });

        const results = new Map();
        tokens.forEach(({ key }) => {
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
  const derivedOverrides = { light: new Map(), dark: new Map() };
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

  const isInputToken = (key) => COLOR_TOKENS.some((token) => token.key === key);
  const isDerivedToken = (key) =>
    DERIVED_COLOR_TOKENS.some((token) => token.key === key);

  const valuesForMode = (mode) =>
    Object.fromEntries(
      ALL_COLOR_TOKENS.map(({ key }) => [key, valueFor(mode, key)]),
    );

  // What a source token is worth for derivation purposes. An untouched field is
  // empty and shows its preset as a placeholder -- the theme still renders with
  // that preset, so derivation has to use it too. Reading only input.value made
  // a single unset source colour blank all 21 derived previews, which is the
  // default state on a fresh install: uci stores nothing until you edit.
  const sourceValueFor = (mode, key) => {
    const typed = valueFor(mode, key).trim();
    if (typed) return typed;
    return (presetColors?.[colorOptionName(mode, key)] || "").trim();
  };

  const automaticForMode = (mode) => {
    if (typeof AuroraTokens === "undefined") return null;
    const inputs = {};
    for (const { key } of COLOR_TOKENS) {
      const value = sourceValueFor(mode, key);
      if (!value) return null;
      inputs[key] = value;
    }
    try {
      return AuroraTokens.resolve(mode, inputs);
    } catch (_error) {
      return null;
    }
  };

  const isDerivedOverride = (mode, key) =>
    Boolean(derivedOverrides[mode].get(key));

  const setDerivedOverride = (mode, key, enabled) => {
    if (!isDerivedToken(key)) return;
    derivedOverrides[mode].set(key, Boolean(enabled));
  };

  const syncDerivedInitialState = (mode, automatic) => {
    if (!automatic) return;
    DERIVED_COLOR_TOKENS.forEach(({ key }) => {
      const field = fields[mode].get(key);
      if (!field || field.initialized) return;

      const saved = field.input.value.trim();
      const autoValue = automatic[key]?.trim() || "";
      const override = Boolean(saved && !sameColorValue(saved, autoValue));
      field.initialized = true;
      setDerivedOverride(mode, key, override);
      if (!override) field.input.value = "";
    });
  };

  // Expand the 10 input colors into a full token snapshot. Derived tokens use
  // automatic values unless the user explicitly supplied an override.
  const resolvedForMode = (mode) => {
    const automatic = automaticForMode(mode);
    if (!automatic) return null;
    syncDerivedInitialState(mode, automatic);

    const resolved = { ...automatic };
    for (const { key } of DERIVED_COLOR_TOKENS) {
      const value = valueFor(mode, key).trim();
      const state = stateFor(mode, key);
      if (isDerivedOverride(mode, key) && value) {
        if (!state.valid) return null;
        resolved[key] = value;
      }
    }

    return resolved;
  };

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
        document.documentElement.style.setProperty(
          property,
          toRuntimeColor(value),
        );
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
        document.documentElement.style.setProperty(
          property,
          toRuntimeColor(resolved[key]),
        );
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

  const updateField = (mode, key, result, options = {}) => {
    const shouldValidate = options.validateKeys?.has(key) ?? false;
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
      if (shouldValidate) triggerValidation(field);
      return;
    }

    try {
      const runtimeColor = toRuntimeColor(result.color);
      field.picker.value = toPickerColor(result.color);
      field.swatch.style.backgroundColor = runtimeColor;
      field.swatch.title = `${_("Resolved color")}: ${runtimeColor}`;
      if (field.token.derived) {
        if (result.autoValue)
          field.input.placeholder = toRuntimeColor(result.autoValue);
        field.status.textContent = "";
      } else {
        field.status.textContent = "";
      }
    } catch (error) {
      state.valid = false;
      state.error = _("Resolved color cannot be shown by the picker.");
      field.input.setCustomValidity(state.error);
      field.element.classList.add("cbi-value-error");
      field.status.textContent = state.error;
    }
    if (shouldValidate) triggerValidation(field);
  };

  const refresh = (mode, options = {}) => {
    const validateKeys = options.validateKeys || new Set();

    return colorLibraryReady
      .then(() => {
        const automatic = automaticForMode(mode);
        syncDerivedInitialState(mode, automatic);

        const validationTokens = COLOR_TOKENS.concat(
          DERIVED_COLOR_TOKENS.filter(
            ({ key }) =>
              isDerivedOverride(mode, key) && valueFor(mode, key).trim(),
          ),
        );

        return resolver
          .resolveMode(mode, valuesForMode(mode), validationTokens)
          .then((results) => ({ automatic, results }));
      })
      .then((results) => {
        COLOR_TOKENS.forEach(({ key }) => {
          updateField(mode, key, results.results.get(key), { validateKeys });
        });

        DERIVED_COLOR_TOKENS.forEach(({ key }) => {
          if (isDerivedOverride(mode, key) && valueFor(mode, key).trim()) {
            const result = results.results.get(key);
            updateField(
              mode,
              key,
              {
                ...result,
                autoValue: results.automatic?.[key] || "",
              },
              { validateKeys },
            );
            return;
          }

          const autoValue = results.automatic?.[key];
          updateField(
            mode,
            key,
            autoValue
              ? { valid: true, color: autoValue, autoValue }
              : {
                  valid: false,
                  error: _("Unable to generate the automatic derived value."),
                },
            { validateKeys },
          );
        });
        applyPreview(mode);
      })
      .catch((error) => {
        ALL_COLOR_TOKENS.forEach(({ key }) => {
          updateField(
            mode,
            key,
            {
              valid: false,
              error:
                error?.message || _("Unable to resolve color expressions."),
            },
            { validateKeys },
          );
        });
      })
      .finally(() => refreshTabErrors(mode));
  };

  const affectedKeysFor = (key) => {
    if (!key) return ALL_COLOR_TOKENS.map((token) => token.key);
    if (isInputToken(key))
      return COLOR_TOKENS.concat(DERIVED_COLOR_TOKENS).map(
        (token) => token.key,
      );
    return [key];
  };

  const schedule = (mode, key, options = {}) => {
    const affectedKeys = affectedKeysFor(key);
    const validateKeys = new Set(options.validate ? [key].filter(Boolean) : []);

    window.clearTimeout(timers[mode]);
    affectedKeys.forEach((affectedKey) => {
      const state = stateFor(mode, affectedKey);
      state.pending = true;
    });
    timers[mode] = window.setTimeout(
      () => refresh(mode, { validateKeys }),
      120,
    );
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
      if (token.derived)
        setDerivedOverride(mode, token.key, Boolean(input.value.trim()));
      schedule(mode, token.key, { validate: true });
    });
    schedule(mode);
  };

  const validate = (mode, key, value) => {
    if (!value?.trim()) return true;
    const state = stateFor(mode, key);
    if (state.pending)
      return state.valid || state.error == null ? true : state.error;
    return state.valid ? true : state.error || _("Invalid color expression.");
  };

  const attach = () => {
    schedule("light");
    schedule("dark");
    modeObserver = new MutationObserver((mutations) => {
      if (
        mutations.some((mutation) => mutation.attributeName === "data-darkmode")
      ) {
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

  const flush = () => {
    window.clearTimeout(timers.light);
    window.clearTimeout(timers.dark);
    return Promise.all([refresh("light"), refresh("dark")]);
  };

  return {
    attach,
    cleanupPreview,
    destroy,
    flush,
    presetColors,
    register,
    resolvedForMode,
    schedule,
    stateFor,
    validate,
  };
};

// Miniature wireframes for the navigation choices. Pure CSS -- no images, no
// requests -- painted from theme variables, so they follow dark mode on their
// own. A dropdown named "Mega Menu" says nothing about what the page will look
// like; these do.
const navWireBar = (width) =>
  E("span", { class: "aurora-nav-wire-bar", style: `width:${width};` });

// What separates the three layouts is which part of the page the menu covers
// when it opens, so that is what each drawing shows: a full-width sheet, a
// narrow panel anchored under one item, or a full-height rail. The page
// content sits underneath, dimmed, which is what makes the dropdown legible --
// you can see the page still showing beside the panel.
// Logo left, menu items centred, icon area right -- the real header's shape.
// The active item has to sit among the menu items: highlighting something in
// the icon area would point at the search button instead of the navigation.
const navTopBar = (activeIndex) =>
  E("span", { class: "aurora-nav-wire-top" }, [
    E("span", { class: "aurora-nav-wire-logo" }),
    E(
      "span",
      { class: "aurora-nav-wire-menu" },
      [0, 1, 2, 3].map((index) =>
        E("span", {
          class:
            "aurora-nav-wire-item" + (index === activeIndex ? " is-active" : ""),
        }),
      ),
    ),
    E("span", { class: "aurora-nav-wire-icon" }),
  ]);

const navWireBarActive = (width) =>
  E("span", { class: "aurora-nav-wire-bar is-active", style: `width:${width};` });

const navUnderlay = (widths) =>
  E(
    "span",
    { class: "aurora-nav-wire-underlay" },
    widths.map((width) => navWireBar(width)),
  );

const NAV_CHOICE_WIREFRAMES = {
  "mega-menu": () =>
    E("span", { class: "aurora-nav-wire" }, [
      navTopBar(1),
      navUnderlay(["70%", "90%", "55%", "80%"]),
      // One entry inside the panel is brand-tinted too: the open menu marks the
      // page you are on, and a panel of uniformly grey bars loses that.
      E("span", { class: "aurora-nav-wire-panel is-full" }, [
        E("span", { class: "aurora-nav-wire-col" }, [
          navWireBar("80%"),
          navWireBar("60%"),
        ]),
        E("span", { class: "aurora-nav-wire-col" }, [
          navWireBar("70%"),
          navWireBarActive("85%"),
        ]),
        E("span", { class: "aurora-nav-wire-col" }, [
          navWireBar("60%"),
          navWireBar("70%"),
        ]),
      ]),
    ]),
  dropdown: () =>
    E("span", { class: "aurora-nav-wire" }, [
      navTopBar(1),
      navUnderlay(["70%", "90%", "55%", "80%"]),
      E("span", { class: "aurora-nav-wire-panel is-anchored" }, [
        E("span", { class: "aurora-nav-wire-col" }, [
          navWireBar("85%"),
          navWireBarActive("65%"),
          navWireBar("75%"),
        ]),
      ]),
    ]),
  sidebar: () =>
    E("span", { class: "aurora-nav-wire aurora-nav-wire-side" }, [
      E("span", { class: "aurora-nav-wire-rail" }, [
        navWireBar("70%"),
        navWireBar("90%"),
        E("span", { class: "aurora-nav-wire-bar is-active", style: "width:75%;" }),
        E("span", { class: "aurora-nav-wire-bar is-child", style: "width:80%;" }),
        navWireBar("65%"),
      ]),
      E("span", { class: "aurora-nav-wire-main" }, [
        navWireBar("55%"),
        E("span", { class: "aurora-nav-wire-bar is-dim", style: "width:85%;" }),
        E("span", { class: "aurora-nav-wire-bar is-dim", style: "width:70%;" }),
      ]),
    ]),
};

const ensureNavChoiceStyles = () => {
  if (document.getElementById("aurora-nav-choice-styles")) return;
  document.head.appendChild(
    E(
      "style",
      { id: "aurora-nav-choice-styles" },
      `
/* Sized to their content and left-aligned: three choices have no reason to
   span the full row, and letting them stretch flattened the thumbnails into
   6:1 letterboxes where a sidebar rail no longer read as a sidebar. */
.aurora-nav-choices {
  display: flex;
  flex-wrap: wrap;
  gap: .75rem;
}
.aurora-nav-choices > .cbi-radio {
  border: 1px solid var(--hairline);
  border-radius: calc(var(--radius-base) * 1.5);
  cursor: pointer;
  display: block;
  flex: 0 0 auto;
  padding: .5rem;
  width: 12rem;
}
.aurora-nav-choices > .cbi-radio:has(input:checked) {
  border-color: var(--brand);
  box-shadow: 0 0 0 1px var(--brand);
}
.aurora-nav-choices > .cbi-radio:focus-within {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
/* Locked to the shape of a screen, never to the shape of its card. */
.aurora-nav-wire {
  aspect-ratio: 4 / 3;
  background: var(--bg);
  border: 1px solid var(--hairline);
  border-radius: var(--radius-base);
  display: block;
  margin-bottom: .45rem;
  /* Clips the sidebar rail to the rounded corners; without it the rail's
     square top-left leaves a notch in the frame. */
  overflow: hidden;
  padding: .3rem;
  position: relative;
}
.aurora-nav-wire-top {
  align-items: center;
  display: flex;
  gap: .18rem;
  height: .5rem;
}
.aurora-nav-wire-menu {
  display: flex;
  flex: 1;
  gap: .18rem;
  justify-content: center;
}
.aurora-nav-wire-logo,
.aurora-nav-wire-item,
.aurora-nav-wire-bar {
  background: var(--hairline);
  border-radius: 1px;
}
.aurora-nav-wire-logo {
  background: var(--text-subtle);
  height: .2rem;
  width: .5rem;
}
.aurora-nav-wire-item {
  height: .2rem;
  width: .4rem;
}
/* A square, because that corner of the header holds the search icon -- a wide
   bar there reads as one more menu item. */
.aurora-nav-wire-icon {
  background: var(--hairline);
  border-radius: 1px;
  height: .22rem;
  width: .22rem;
}
.aurora-nav-wire-bar {
  height: .18rem;
}
.aurora-nav-wire-item.is-active,
.aurora-nav-wire-bar.is-active {
  background: var(--brand);
}
.aurora-nav-wire-bar.is-child {
  margin-left: 18%;
}
.aurora-nav-wire-bar.is-dim {
  opacity: .5;
}
.aurora-nav-wire-underlay {
  display: flex;
  flex-direction: column;
  gap: .18rem;
  left: .3rem;
  opacity: .3;
  position: absolute;
  right: .3rem;
  top: 1rem;
}
/* The panel floats above the page: that is the whole distinction between a
   full-width sheet and a dropdown anchored under one item. */
.aurora-nav-wire-panel {
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: 3px;
  box-shadow: 0 2px 5px rgba(0, 0, 0, .16);
  display: flex;
  gap: .25rem;
  padding: .25rem;
  position: absolute;
  top: .95rem;
}
.aurora-nav-wire-panel.is-full {
  left: .3rem;
  right: .3rem;
}
.aurora-nav-wire-panel.is-anchored {
  right: 22%;
  width: 38%;
}
.aurora-nav-wire-col,
.aurora-nav-wire-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: .18rem;
}
.aurora-nav-wire-side {
  display: flex;
  gap: .25rem;
  padding: 0;
}
.aurora-nav-wire-rail {
  background: var(--surface);
  border-right: 1px solid var(--hairline);
  display: flex;
  flex-direction: column;
  gap: .2rem;
  padding: .3rem;
  width: 32%;
}
.aurora-nav-wire-main {
  gap: .2rem;
  padding: .3rem .3rem .3rem 0;
}
`,
    ),
  );
};

const renderNavChoiceWidget = function (section_id, option_index, cfgvalue) {
  ensureNavChoiceStyles();
  const node = form.ListValue.prototype.renderWidget.apply(this, arguments);
  node.classList.add("aurora-nav-choices");

  // ui.Select separates horizontal radios with " \xa0 " text nodes; they would
  // wedge gaps into the flex row.
  Array.from(node.childNodes)
    .filter((child) => child.nodeType !== Node.ELEMENT_NODE)
    .forEach((child) => node.removeChild(child));

  node.querySelectorAll("input[type=radio]").forEach((input) => {
    const wireframe = NAV_CHOICE_WIREFRAMES[input.value];
    if (!wireframe || !input.parentNode) return;
    // Before the input, never between input/label/text: ui.Select's caption
    // handler reaches the input via previousElementSibling twice, and breaking
    // that chain would silently kill click-to-select.
    const drawing = wireframe();
    drawing.addEventListener("click", () => input.click());
    input.parentNode.insertBefore(drawing, input);
  });

  return node;
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
    element.dataset.auroraColorMode = mode;
    element.dataset.auroraColorKind = token.derived ? "derived" : "base";
    element.dataset.auroraColorGroup = token.group || "";
    input.placeholder = token.derived
      ? _("Automatic")
      : presetValue || _("Saved or preset value");

    const picker = E("input", {
      type: "color",
      value: "#000000",
      style:
        "position:absolute;inset:0;width:100%;height:100%;margin:0;padding:0;border:0;opacity:0;cursor:pointer;",
      title: _("Choose a literal color for this token"),
    });
    const swatch = E(
      "span",
      {
        style:
          "position:relative;display:inline-block;width:2rem;height:2rem;margin-left:.5rem;border:1px solid currentColor;border-radius:.5rem;vertical-align:middle;background:transparent;overflow:hidden;cursor:pointer;",
        title: _("Resolved preview color - click to pick"),
      },
      [picker],
    );
    const status = E("small", {
      style: "display:block;margin-top:.35rem;opacity:.75;",
    });

    const controls = E("span", {}, [swatch]);
    input.parentNode.appendChild(controls);
    input.parentNode.appendChild(status);

    picker.addEventListener("change", () => {
      try {
        input.value = picker.value;
        input.dispatchEvent(new Event("input"));
      } catch (error) {
        input.setCustomValidity(_("Unable to convert the selected color."));
      }
    });

    editor.register(mode, token, element, input, this, sectionId, {
      picker,
      status,
      swatch,
    });
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
        uci.set("aurora", sectionId, optionKey, toRuntimeColor(trimmed));
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
  // Source tokens hang straight off the mode sub-tab -- no SectionValue in
  // between. addColorInputs speaks section.option(...), so this adapter turns
  // those calls into taboption(mode, ...) without touching its signature.
  addColorInputs(
    { option: (...args) => section.taboption(mode, ...args) },
    mode,
    COLOR_TOKENS,
    editor,
  );

  // The derived tokens keep the one remaining wrapper. It earns its place
  // twice over: it gives the 30 fields a DOM container for enhanceDerivedFold
  // to collapse, and it keeps them out of the source rows' parent, which is
  // how enhanceColorTokenGroups tells the two apart (it groups by
  // row.parentElement). It renders no title -- the fold's summary is the label.
  const derivedSection = section.taboption(
    mode,
    form.SectionValue,
    `_${mode}_derived_colors`,
    form.NamedSection,
    "theme",
    "aurora",
  );
  addColorInputs(
    derivedSection.subsection,
    mode,
    DERIVED_COLOR_GROUPS.flatMap((group) =>
      DERIVED_COLOR_TOKENS.filter((token) => token.group === group.key),
    ),
    editor,
  );
};

const colorGroupFor = (kind, key) =>
  (kind === "derived" ? DERIVED_COLOR_GROUPS : COLOR_GROUPS).find(
    (group) => group.key === key,
  );

const ensureColorGroupStyles = () => {
  if (document.getElementById("aurora-color-group-styles")) return;
  document.head.appendChild(
    E(
      "style",
      { id: "aurora-color-group-styles" },
      `
/* Both folds -- the per-group headings and the derived block -- share one
   summary treatment. They differ only in how they draw their chevron: the
   groups use a real button so a stray click cannot collapse them, the derived
   block is a plain marker. */
.aurora-token-group,
.aurora-derived-fold {
  margin: 0;
}
.aurora-token-group > summary,
.aurora-derived-fold > summary {
  align-items: center;
  border-bottom: 1px solid var(--hairline);
  display: flex;
  gap: 1rem;
  list-style: none;
  padding: 1rem 0 .75rem;
}
.aurora-token-group > summary::-webkit-details-marker,
.aurora-derived-fold > summary::-webkit-details-marker {
  display: none;
}
.aurora-token-group > summary {
  cursor: default;
  justify-content: space-between;
}
.aurora-derived-fold > summary {
  cursor: pointer;
}
.aurora-derived-fold > summary::before {
  color: var(--text-muted);
  content: "\\25B8";
  transition: rotate .2s ease;
}
.aurora-derived-fold[open] > summary::before {
  rotate: 90deg;
}
.aurora-token-group-title,
.aurora-derived-fold-title {
  display: block;
  font-size: 1rem;
  font-weight: 700;
}
.aurora-token-group-description,
.aurora-derived-fold-description {
  color: var(--text-muted);
  display: block;
  font-size: .875rem;
  line-height: 1.45;
}
.aurora-token-group-description {
  margin-top: .25rem;
}
.aurora-token-group-body {
  padding: 1rem 0;
}
/* Box + interaction reset; the chevron glyph is reused from the Aurora theme's
   .navigation-group-toggle::after, so no SVG is duplicated here. */
.aurora-token-group-toggle {
  align-items: center;
  appearance: none;
  background: transparent;
  border: 0;
  border-radius: 999px;
  color: var(--text-muted);
  cursor: pointer;
  display: inline-flex;
  flex-shrink: 0;
  height: 1.75rem;
  justify-content: center;
  padding: 0;
  width: 1.75rem;
}
.aurora-token-group-toggle:hover {
  color: var(--text);
}
.aurora-token-group-toggle:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;
}
.aurora-token-group-toggle::after {
  transition: rotate .25s ease;
}
.aurora-token-group[open] .aurora-token-group-toggle::after {
  rotate: 90deg;
}
/* Derived colours: 21 tokens nobody edits on most installs. As a tile grid the
   whole computed palette is visible at once instead of scrolling past 21
   near-identical rows, and each tile still holds its real input. */
.aurora-derived-host {
  display: block;
}
.aurora-derived-host > .cbi-value-title {
  display: none;
}
/* The fold only groups rows. Left alone the theme gives this nested section the
   same card chrome as the page card around it -- a border, radius and shadow
   drawn a second time just inside the first. The #maincontent prefix is not
   decoration: the theme sets that chrome from "#maincontent .cbi-section", and
   a plain class selector loses to it. */
#maincontent .aurora-derived-fold > .cbi-section {
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  margin: 0;
  padding: 0;
}
.aurora-derived-fold .aurora-token-group-body {
  display: grid;
  gap: .5rem;
  grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
}
.aurora-tile {
  align-items: center;
  border: 1px solid var(--hairline);
  border-radius: var(--radius-base);
  display: grid;
  gap: 0 .5rem;
  grid-template-areas: "swatch title" "swatch field";
  grid-template-columns: auto 1fr;
  padding: .5rem;
}
/* The theme spaces stacked rows with ".cbi-value + .cbi-value{margin-top}".
   In a grid that is the gap's job, and the stray top margin left the first
   tile of each row 12px taller than its neighbours, since grid items stretch
   to the row height while the others start lower. Matching the adjacent-
   sibling specificity is what makes this stick. */
.aurora-tile + .aurora-tile,
.aurora-derived-fold .aurora-token-group-body > .cbi-value {
  margin: 0;
}
.aurora-tile > .aurora-tile-swatch {
  grid-area: swatch;
}
.aurora-tile > .cbi-value-title {
  font-size: .8125rem;
  grid-area: title;
  min-width: 0;
  overflow: hidden;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: auto;
}
.aurora-tile > .cbi-value-field {
  grid-area: field;
  min-width: 0;
}
/* Width only. Shrinking the font and padding squashed the theme's pill input
   without shrinking its radius, so the tiles ended up with flattened capsules
   that matched nothing else on the page. */
.aurora-tile input[type="text"] {
  width: 100%;
}
/* The description is the tile's tooltip instead; the validation message under
   the input is not hidden -- a rejected colour has to say so. */
.aurora-tile .cbi-value-description {
  display: none;
}
`,
    ),
  );
};

const enhanceColorTokenGroups = (root) => {
  ensureColorGroupStyles();
  const rows = Array.from(root.querySelectorAll("[data-aurora-color-group]"));
  const containers = new Set(
    rows.map((row) => row.parentElement).filter(Boolean),
  );

  containers.forEach((container) => {
    if (container.dataset.auroraTokenGroupsEnhanced === "true") return;
    const children = Array.from(container.children).filter(
      (child) => child.dataset?.auroraColorGroup,
    );
    if (children.length === 0) return;

    container.dataset.auroraTokenGroupsEnhanced = "true";
    let index = 0;
    while (index < children.length) {
      const first = children[index];
      const groupKey = first.dataset.auroraColorGroup;
      const kind = first.dataset.auroraColorKind;
      const groupRows = [];

      while (
        index < children.length &&
        children[index].dataset.auroraColorGroup === groupKey
      ) {
        groupRows.push(children[index]);
        index += 1;
      }

      const group = colorGroupFor(kind, groupKey);
      if (!group) continue;

      const body = E("div", { class: "aurora-token-group-body" });
      const toggle = E("button", {
        type: "button",
        // Reuse the Aurora theme's navigation chevron glyph; the local class
        // only adds the button box reset and the open-state rotation.
        class: "aurora-token-group-toggle navigation-group-toggle",
        "aria-label": _("Expand or collapse this group"),
        "aria-expanded": "true",
      });
      const summary = E("summary", {}, [
        E("span", {}, [
          E("span", { class: "aurora-token-group-title" }, group.title),
          E(
            "span",
            { class: "aurora-token-group-description" },
            group.description,
          ),
        ]),
        toggle,
      ]);

      const details = E("details", { class: "aurora-token-group", open: "" }, [
        summary,
        body,
      ]);

      // A bare <summary> toggles on ANY click anywhere on the header strip, so a
      // stray click -- notably the click that dismisses the native color picker
      // landing on this large header -- would collapse the group. Restrict
      // toggling to the chevron button: it drives the open state explicitly,
      // every other summary click is cancelled, and the toggle listener reverts
      // any collapse that still slips through to the expected state.
      let expectedOpen = true;
      const setGroupOpen = (open) => {
        expectedOpen = open;
        if (details.open !== open) details.open = open;
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      };
      toggle.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        setGroupOpen(!expectedOpen);
      });
      summary.addEventListener("click", (ev) => {
        if (!ev.target.closest(".aurora-token-group-toggle"))
          ev.preventDefault();
      });
      details.addEventListener("toggle", () => {
        if (details.open !== expectedOpen) details.open = expectedOpen;
      });

      container.insertBefore(details, first);
      groupRows.forEach((row) => body.appendChild(row));
    }
  });
};

// Collapse each mode's derived tokens into one fold. The anchor is the
// .cbi-section that createColorSections keeps around them -- the one wrapper
// that survived the flattening. Thirty automatic tokens are a reference, not
// a control panel: they stay one click away rather than pushing the ten source
// colours off the top of the page.
const enhanceDerivedFold = (root) => {
  const derivedRows = Array.from(
    root.querySelectorAll('[data-aurora-color-kind="derived"]'),
  );
  const sections = new Set(
    derivedRows
      .map((row) => row.closest(".cbi-section"))
      .filter((section) => section && !section.dataset.auroraDerivedFolded),
  );

  sections.forEach((section) => {
    section.dataset.auroraDerivedFolded = "true";
    const summary = E("summary", {}, [
      E("span", { class: "aurora-derived-fold-title" }, _("Derived Colors")),
      E(
        "span",
        { class: "aurora-derived-fold-description" },
        _(
          "Computed from the source colors; leave a field empty to keep its automatic value.",
        ),
      ),
    ]);
    const details = E("details", { class: "aurora-derived-fold" }, [summary]);
    section.parentNode.insertBefore(details, section);
    details.appendChild(section);
    // The SectionValue renders inside a .cbi-value flex row that still holds an
    // empty title column; left alone it takes a third of the width off a grid
    // that wants all of it.
    details.parentElement?.classList.add("aurora-derived-host");
  });

  // Reshape each derived row into a tile: the swatch leads, the label and the
  // input stack beside it. Moving the node is safe -- the colour editor holds
  // it by reference and keeps repainting it wherever it lives.
  derivedRows.forEach((row) => {
    if (row.dataset.auroraTileBuilt) return;
    const picker = row.querySelector('input[type="color"]');
    const swatch = picker?.parentElement;
    if (!swatch) return;
    row.dataset.auroraTileBuilt = "true";
    row.classList.add("aurora-tile");
    swatch.classList.add("aurora-tile-swatch");
    swatch.style.marginLeft = "0";
    row.insertBefore(swatch, row.firstChild);

    // The description is hidden by the grid; keep it reachable on hover.
    const description = row.querySelector(".cbi-value-description");
    const text = description?.textContent?.trim();
    if (text) row.title = text;
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

        const viewportMax = () =>
          typeof config.max === "function" ? config.max() : Number(config.max);

        const storedNum = parseFloat(
          String(input.value || self.default || "").trim(),
        );
        const numValue = storedNum || config.default;
        const format = (value) => `${value.toFixed(config.precision)}rem`;

        // The ceiling tracks the viewport — widening past it changes nothing on
        // screen — but it must never fall below a value that is already stored.
        // A config written on a wider display otherwise clamps the slider to
        // its own maximum while the readout still shows the larger number, and
        // the next drag silently rewrites the setting.
        const ceiling = () =>
          Number.isFinite(storedNum)
            ? Math.max(viewportMax(), storedNum)
            : viewportMax();

        const valueDisplay = E(
          "span",
          {
            style: `margin-left: 10px; min-width: ${config.displayWidth}px; display: inline-block;`,
          },
          format(numValue),
        );

        const commit = (value) => {
          input.value = format(value);
          valueDisplay.textContent = input.value;
        };

        const rangeInput = E("input", {
          type: "range",
          min: config.min.toString(),
          max: ceiling().toString(),
          step: config.step.toString(),
          value: numValue,
          style: "width: 200px; vertical-align: middle;",
          input: function () {
            commit(parseFloat(this.value));
          },
        });

        if (typeof config.max === "function") {
          const handleResize = () => {
            const max = ceiling();
            rangeInput.max = max.toString();
            if (parseFloat(rangeInput.value) > max) {
              rangeInput.value = max;
              commit(max);
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

// Widening past the viewport has no visible effect, so the ceiling tracks the
// current window rather than being an arbitrary constant.
const viewportWidthInRem = () => {
  const rootFontSize = parseFloat(
    window.getComputedStyle(document.documentElement).fontSize,
  );
  const usable = window.innerWidth * (23 / 24);
  return Math.max(Math.floor((usable / rootFontSize) * 10) / 10, 80);
};

const renderContentWidthControl = createRangeControlRenderer({
  min: "72",
  max: viewportWidthInRem,
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

// 正则先绑常量,绝不能让字面量紧跟在箭头后面 —— jsmin 会把它当成除号,压缩
// 产物直接语法错误。见 docs/DEVELOPMENT.md §11 与 tests/jsmin-safety.test.mjs。
const IMAGE_NAME_RE = /\.(jpg|jpeg|png|gif|webp|avif|svg|bmp|ico)$/i;
const PNG_NAME_RE = /\.png$/i;
const ICO_NAME_RE = /\.ico$/i;

const isImageFile = (filename) => IMAGE_NAME_RE.test(filename);

const makeIconListLoader = (
  filterFn,
  { prepend = [], empty = [], valueForIcon = (icon) => icon } = {},
) =>
  function (section_id) {
    return getIconsOnce().then(
      L.bind(function (response) {
        const icons = response?.icons || [];
        const matches = icons.filter(filterFn);
        this.keylist = [];
        this.vallist = [];
        prepend.forEach(([value, label]) => this.value(value, label));
        if (matches.length > 0) {
          matches.forEach((icon) => this.value(valueForIcon(icon), icon));
        } else {
          empty.forEach(([value, label]) => this.value(value, label));
        }
        return form.ListValue.prototype.load.apply(this, [section_id]);
      }, this),
    );
  };

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
      uci.set(
        "aurora",
        "theme",
        `${mode}_${key}`,
        toRuntimeColor(resolved[key]),
      );
    });
  });
};

const runSavePipeline = function (ev, after) {
  const save = L.bind(function () {
    return colorLibraryReady
      .catch(() => {})
      .then(() => this.colorEditor?.flush?.())
      .then(() => this.super("handleSave", [ev]))
      .then(() => persistDerivedTokens(this.colorEditor))
      .then(() => uci.save());
  }, this);
  const writePwa = () => L.resolveDefault(callWritePwaManifest(), {});
  const cleanup = () => this.colorEditor?.cleanupPreview();
  const handleFailure = (error) => {
    cleanup();
    throw error;
  };
  const saveReady =
    typeof this.prepareAuroraFonts === "function"
      ? this.prepareAuroraFonts().then(save)
      : save();

  return saveReady.then(writePwa).then(after).catch(handleFailure);
};

return view.extend({
  handleSave: function (ev) {
    return runSavePipeline.call(this, ev, () =>
      this.colorEditor?.cleanupPreview(),
    );
  },

  handleSaveApply: function (ev, mode) {
    const apply = () => {
      this.colorEditor?.cleanupPreview();
      ui.changes.apply(mode === "0");
    };
    return runSavePipeline.call(this, ev, apply);
  },

  handleReset: function (ev) {
    this.colorEditor?.cleanupPreview();
    return this.super("handleReset", [ev]).then(() => {
      this.colorEditor?.schedule("light");
      this.colorEditor?.schedule("dark");
    });
  },

  load: function () {
    // colorLibraryReady must settle before the form builds: the token tables
    // (COLOR_TOKENS et al.) are joined from the AuroraTokens registry once the
    // engine scripts load. A load failure rejects here instead of silently
    // rendering a page with no derived-token preview.
    return Promise.all([
      uci.load("aurora"),
      L.resolveDefault(callGetInitData(), {}),
      colorLibraryReady,
      // Already fetched and session-cached while LuCI rendered the navigation,
      // so this resolves from cache rather than costing a request.
      L.resolveDefault(ui.menu.load(), null),
    ]).then(([uciData, initData, , menuTree]) => {
      // Theme config comes from the uci cache populated by uci.load("aurora")
      // above, so no separate theme-config RPC is needed.
      const themeConfig = readThemeConfigFromUci();
      const iconsData = {
        icons: Array.isArray(initData?.icons) ? initData.icons : [],
        icon_sizes:
          initData?.icon_sizes && typeof initData.icon_sizes === "object"
            ? initData.icon_sizes
            : {},
      };
      if (Array.isArray(initData?.icons))
        _iconsPromise = Promise.resolve(iconsData);

      // Preserve the positional layout render() expects:
      // [0]=uci [1]={theme} [2]=versions [3]=fonts [4]=icons [5]=preset
      // [6]=feed [7]=menu
      return [
        uciData,
        { theme: themeConfig },
        initData?.versions || {},
        { fonts: initData?.fonts || {} },
        iconsData,
        initData?.theme_preset || { result: -1, colors: {} },
        initData?.feed || { pm: "unknown", configured: false, channel: "" },
        menuTree,
      ];
    });
  },

  render(loadData) {
    const themeConfig = loadData[1]?.theme || {};
    const installedVersions = loadData[2];
    const fontPresetsBySlot = loadData[3]?.fonts || {};
    const presetColors = loadData[5]?.colors || {};
    const feedStatus = loadData[6] || {
      pm: "unknown",
      configured: false,
      channel: "",
    };
    const menuTree = loadData[7];
    this.colorEditor?.destroy();
    const colorEditor = createColorEditor(themeConfig, presetColors);
    this.colorEditor = colorEditor;

    const m = new form.Map("aurora", _("Theme Studio"));

    const themeVersion =
      installedVersions?.theme?.installed_version || "Unknown";
    const configVersion =
      installedVersions?.config?.installed_version || "Unknown";

    let so;
    const viewCtx = this;

    const FONT_DEFAULT_STACKS = {
      sans: '"Lato", ui-sans-serif, system-ui, sans-serif',
      mono: 'ui-monospace, "SF Mono", Menlo, Monaco, Consolas, monospace',
    };

    const fontOptionsCache = {};
    const buildFontOptions = (slot) => {
      if (fontOptionsCache[slot]) return fontOptionsCache[slot];
      fontOptionsCache[slot] = computeFontOptions(slot);
      return fontOptionsCache[slot];
    };

    const computeFontOptions = (slot) => {
      const list = fontPresetsBySlot?.[slot];
      const custom = (fontPresetsBySlot?.custom || [])
        .filter((font) => font?.slot === slot && font?.name)
        .map((font) => ({
          name: "custom-" + font.name,
          label: font.family || font.name,
          source: _("Custom"),
          family: font.family || "",
          stack: font.stack || "",
          custom: true,
          customName: font.name,
        }));
      if (Array.isArray(list) && list.length > 0) {
        const options = list
          .filter((font) => font?.name)
          .map((font) => ({
            name: font.name,
            label: font.label || font.name,
            source: font.source || "",
            family: font.family || "",
            stack: font.stack || "",
          }))
          .concat(custom);
        if (options.length > 0) return options;
      }
      // Preset list unavailable (e.g. font-presets.conf unreadable):
      // uploaded custom fonts still exist on disk, keep them selectable.
      const fallbackStack = FONT_DEFAULT_STACKS[slot] || "";
      if (!fallbackStack) return custom;
      return [
        {
          name: "default",
          label: slot === "sans" ? "Lato" : _("System Mono"),
          source: _("Built-in"),
          stack: fallbackStack,
        },
      ].concat(custom);
    };

    const buildConfigToolbarNode = () => {
      // The preset dropdown moved to the Marketplace's "Built-in" group, and
      // the store itself is one tabmenu entry away -- a header button for it
      // would be a second entrance to the same page. What is left here are the
      // config-level actions, which have nowhere else to live.
      const exportButton = E(
        "button",
        {
          class: "cbi-button cbi-button-apply",
          title: _("Export Aurora Settings"),
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
          title: _("Import Aurora Settings"),
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

                  ui.showModal(_("Import Aurora Configuration?"), [
                    E(
                      "p",
                      {},
                      _(
                        "Importing replaces /etc/config/aurora, applies all settings, and reloads the page. Uploaded images stay on disk.",
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
                        _("Import"),
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
          title: _("Reset All Aurora Settings"),
          click: ui.createHandlerFn(viewCtx, () => {
            return ui.showModal(_("Reset All Aurora Settings"), [
              E(
                "p",
                {},
                _(
                  "Reset /etc/config/aurora to the packaged Default preset — colors, layout, typography, branding, navigation, and toolbar. Uploaded images stay on disk; custom selections not in the Default preset are cleared.",
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
                  _("Reset"),
                ),
              ]),
            ]);
          }),
        },
        _("Reset"),
      );

      return E(
        "div",
        {
          class: "aurora-config-toolbar",
          style: "display:flex; flex-wrap:wrap; gap:0.5em; align-items:center;",
        },
        [exportButton, importButton, resetButton],
      );
    };

    // Named node on purpose: the update-source check appends an "update
    // available" capsule here once it has compared the feed manifest.
    const versionArea = E(
      "div",
      {
        style:
          "display: flex; flex-wrap: wrap; gap: 1em; align-items: center;",
      },
      [
        E("span", { style: "white-space: nowrap;" }, [
          document.createTextNode(_("Theme: ")),
          E(
            "span",
            {
              id: "theme-version",
              class: "label success",
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
            },
            `v${configVersion}`,
          ),
        ]),
      ],
    );

    const headerBar = E(
      "div",
      {
        style:
          "display: flex; flex-wrap: wrap; gap: 1em; align-items: center; justify-content: space-between;",
      },
      [versionArea, buildConfigToolbarNode()],
    );

    m.description = headerBar;

    // ------------------------------------------------------------------
    // Update source. Adding it is a local file operation and has to go
    // through rpcd; checking for a newer build is a pure read and goes
    // straight from the browser to the CDN, so the router takes no part.

    const packagePagePath = feedCheck.pickPackageManagerPath(menuTree);

    const goToSoftware = (label) =>
      packagePagePath
        ? E("a", { class: "cbi-button", href: L.url(packagePagePath) }, label)
        : null;

    const checkForUpdates = () => {
      // Not configured means there is nothing to compare against, so no
      // request goes out at all.
      if (!feedStatus.configured) return Promise.resolve(null);

      const cached = sessionStorage.getItem(MANIFEST_CACHE_KEY);
      if (cached) {
        try {
          return Promise.resolve(JSON.parse(cached));
        } catch (error) {
          sessionStorage.removeItem(MANIFEST_CACHE_KEY);
        }
      }

      return fetch(MANIFEST_URL, { credentials: "omit" })
        .then((response) => (response.ok ? response.json() : null))
        .then((manifest) => {
          if (manifest)
            sessionStorage.setItem(
              MANIFEST_CACHE_KEY,
              JSON.stringify(manifest),
            );
          return manifest;
        })
        // Offline, feed unreachable, CORS not deployed yet -- all the same
        // outcome: say nothing. A settings page has no business raising an
        // error because it could not reach an update server.
        .catch(() => null);
    };

    const showUpdateCapsule = (manifest) => {
      if (!manifest) return;
      const channel = feedStatus.channel || "snapshots";
      const format = feedStatus.pm === "opkg" ? "opkg" : "apk";
      const packages = [
        ["luci-theme-aurora", themeVersion],
        ["luci-app-aurora-config", configVersion],
      ];

      packages.forEach(([pkg, installed]) => {
        const available = feedCheck.findManifestVersion(
          manifest,
          channel,
          format,
          pkg,
        );
        if (!feedCheck.isNewer(installed, available)) return;
        const label = _("Update available %s").format(available);
        versionArea.appendChild(
          packagePagePath
            ? E(
                "a",
                { class: "label warning", href: L.url(packagePagePath) },
                label,
              )
            : E("span", { class: "label warning" }, label),
        );
      });
    };

    const buildFeedNotice = () => {
      if (feedStatus.pm === "unknown" || feedStatus.configured) return null;
      if (localStorage.getItem(FEED_NOTICE_KEY) === "1") return null;

      const notice = E("div", {
        class: "alert-message warning",
        style: "display:flex; gap:1em; align-items:center; flex-wrap:wrap;",
      });

      const fill = (nodes, className) => {
        notice.className = className;
        while (notice.firstChild) notice.removeChild(notice.firstChild);
        nodes.filter(Boolean).forEach((node) => notice.appendChild(node));
      };

      const runAddFeed = () => {
        ui.hideModal();
        fill(
          [E("span", { class: "spinning" }, _("Adding the update source…"))],
          "alert-message",
        );
        return L.resolveDefault(callAddFeed(), { result: 1 }).then((ret) => {
          if (ret?.result !== 0) {
            fill(
              [
                E(
                  "span",
                  {},
                  _("Could not add the update source: %s").format(
                    ret?.error || _("Unknown error"),
                  ),
                ),
              ],
              "alert-message warning",
            );
            return;
          }
          if (!ret.index_refreshed) {
            // The source is on disk; only the index refresh failed, and the
            // Software page can redo that itself. Saying "failed" flatly here
            // would send the user to undo work that succeeded.
            fill(
              [
                E(
                  "span",
                  { style: "flex:1;" },
                  _(
                    "The update source was written, but refreshing the index failed. Hit Refresh on the Software page later.",
                  ),
                ),
                goToSoftware(_("Go to Software")),
              ],
              "alert-message warning",
            );
            return;
          }
          fill(
            [
              E("span", { style: "flex:1;" }, _("Update source added")),
              goToSoftware(_("Go to Software")),
            ],
            "alert-message success",
          );
        });
      };

      fill(
        [
          E(
            "span",
            { style: "flex:1;" },
            _(
              "Upgrading Aurora needs its update source. Once added, upgrades happen in System → Software like any other OpenWrt package.",
            ),
          ),
          E(
            "button",
            {
              class: "cbi-button cbi-button-action",
              click: ui.createHandlerFn(viewCtx, () =>
                ui.showModal(_("Add the Aurora update source"), [
                  E(
                    "p",
                    {},
                    _(
                      "Afterwards you can upgrade Aurora in System → Software, like any other OpenWrt package.",
                    ),
                  ),
                  E(
                    "p",
                    { class: "cbi-value-description" },
                    _(
                      "From openwrt.eamonxg.fun; the signing key ships with this package.",
                    ),
                  ),
                  E("div", { class: "right" }, [
                    E("button", { class: "btn", click: ui.hideModal }, _("Cancel")),
                    " ",
                    E(
                      "button",
                      { class: "btn cbi-button-action important", click: runAddFeed },
                      _("Add"),
                    ),
                  ]),
                ]),
              ),
            },
            _("Add update source"),
          ),
          E(
            "button",
            {
              class: "cbi-button",
              "aria-label": _("Dismiss"),
              // localStorage, not uci: closing a hint should not raise an
              // unsaved-changes banner, nor cost a round trip.
              click: () => {
                localStorage.setItem(FEED_NOTICE_KEY, "1");
                notice.parentNode?.removeChild(notice);
              },
            },
            "×",
          ),
        ],
        "alert-message warning",
      );

      return notice;
    };

    const s = m.section(form.NamedSection, "theme", "aurora");

    s.tab("colors", _("Colors"));
    s.tab("layout_typography", _("Layout & Typography"));
    s.tab("icons_branding", _("Branding & Shortcuts"));

    const colorSection = s.taboption(
      "colors",
      form.SectionValue,
      "_colors",
      form.NamedSection,
      "theme",
      "aurora",
    );
    const colorSubsection = colorSection.subsection;
    colorSubsection.tab("light", _("Light Mode"), COLOR_TAB_HINT);
    colorSubsection.tab("dark", _("Dark Mode"), COLOR_TAB_HINT);

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
        "Navigation, spacing, corner radius, and content width. Takes effect after Save & Apply.",
      ),
    );
    const structureSubsection = structureSection.subsection;

    so = structureSubsection.option(
      form.ListValue,
      "nav_type",
      _("Navigation Style"),
    );
    so.description = _("Layout pattern for the primary navigation menu.");
    so.value("mega-menu", _("Mega Menu"));
    so.value("dropdown", _("Dropdown"));
    so.value("sidebar", _("Sidebar"));
    so.default = "mega-menu";
    so.rmempty = false;
    // Still a ListValue: struct_content_width_centered depends() on this, and
    // LuCI's dependency tracking rides on the standard widget's change event.
    // A hand-rolled control would make parse() drop the width on save -- see
    // the retain comment below. So the radios stay, and only get a picture.
    so.widget = "radio";
    so.renderWidget = renderNavChoiceWidget;

    so = structureSubsection.option(
      form.Value,
      "struct_spacing",
      _("Spacing Scale"),
    );
    so.description = _(
      "Base spacing unit that scales padding and gaps across the interface.",
    );
    so.default = "0.25rem";
    so.placeholder = "0.25rem";
    so.rmempty = false;
    so.render = renderSpacingControl;

    so = structureSubsection.option(
      form.Value,
      "struct_radius_base",
      _("Corner Radius"),
    );
    so.description = _(
      "Base corner radius applied to buttons, inputs, cards, and surfaces.",
    );
    so.default = "0.5rem";
    so.placeholder = "0.5rem";
    so.rmempty = false;
    so.render = renderRadiusControl;

    // Centred layouts only. The sidebar shell is asymmetric — its first column
    // already acts as the margin — so the theme runs it full-width and reads no
    // cap; offering this control there would be a dead knob.
    so = structureSubsection.option(
      form.Value,
      "struct_content_width_centered",
      _("Content Max Width"),
    );
    so.description = _("Maximum width of the centered content area.");
    so.default = "80rem";
    so.placeholder = "80rem";
    so.rmempty = false;
    so.render = renderContentWidthControl;
    // Required alongside depends: LuCI's parse() deletes any option whose
    // depends are unsatisfied at save time (form.js CBIAbstractValue.parse), so
    // without retain, saving anything while the Sidebar layout is selected
    // silently drops this width entirely.
    so.retain = true;
    so.depends("nav_type", "mega-menu");
    so.depends("nav_type", "dropdown");

    const fontSection = s.taboption(
      "layout_typography",
      form.SectionValue,
      "_font_settings",
      form.NamedSection,
      "theme",
      "aurora",
      _("Typography"),
      _(
        "Sans-serif and monospace typefaces used across the theme. Pick a curated webfont — downloaded once after saving, from pinned, checksum-verified sources, then served locally — or upload your own .woff2 files.",
      ),
    );
    const fontSubsection = fontSection.subsection;

    const fontTableSo = fontSubsection.option(
      form.DummyValue,
      "_font_table",
      _("Custom Fonts"),
    );
    fontTableSo.rawhtml = false;
    fontTableSo.cfgvalue = () => "";
    // renderWidget (not render): LuCI's renderFrame() then wraps the manager
    // in the standard cbi-value label/field row, matching the typeface
    // selects below. The brand-asset manager overrides render() instead --
    // its section holds only the table, so it stays full-width.
    fontTableSo.renderWidget = () => {
      const FONT_TMP_PATH = "/tmp/aurora_font.tmp";
      const customs = fontPresetsBySlot?.custom || [];

      // 同 IMAGE_NAME_RE 上方的说明:正则不能紧跟在箭头后面。
      const LOWER_START_RE = /^[a-z]/;

      const familyFromFilename = (name) => {
        const stem = name.replace(/\.woff2$/i, "");
        const parts = stem
          .split(/[-_]+/)
          .filter(
            (p) =>
              !/^(regular|bold|light|medium|semibold|thin|italic|normal|latin|\d+)$/i.test(
                p,
              ),
          );
        const words = parts.length ? parts : [stem];
        return words
          .map((w) =>
            LOWER_START_RE.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : w,
          )
          .join(" ");
      };

      const removeFont = (font) =>
        assetUpload.confirmDelete({
          title: _("Delete Custom Font"),
          message: _(
            "Delete '%s'? The interface will fall back to the default typeface.",
          ).format(font.family),
        }).then((confirmed) => {
          if (!confirmed) return;
          return L.resolveDefault(
            callRemoveFont(font.slot, font.name),
            {},
          ).then((ret) => {
            if (ret?.result === 0) window.location.reload();
            else
              ui.addNotification(
                null,
                E(
                  "p",
                  _("Delete failed: %s").format(ret?.error || _("Unknown")),
                ),
                "error",
              );
          });
        });

      const fontManager = assetUpload.createAssetManager({
        badgeHeader: _("Slot"),
        emptyText: _("No custom fonts uploaded."),
        rows: customs.map((font) => ({
          preview: E(
            "div",
            {
              style:
                "width:34px;height:34px;border-radius:0.4em;" +
                "background:var(--surface-sunken);border:1px solid var(--hairline);" +
                "display:flex;align-items:center;justify-content:center;" +
                "font-weight:700;font-size:0.95em;" +
                "font-family:" +
                (font.slot === "mono" ? "var(--font-mono)" : "var(--font-sans)") +
                ";",
            },
            "Aa",
          ),
          name: font.family,
          badge: font.slot === "sans" ? _("Sans-Serif") : _("Monospace"),
          size: font.size || 0,
          onDelete: ui.createHandlerFn(viewCtx, () => removeFont(font)),
        })),
        bar: {
          hint: _("Drop a .woff2 font here, or click to browse"),
          sub: _("Only .woff2 files up to 8MB are accepted."),
          accept: ".woff2",
        },
        checkFile: (file) => assetUpload.checkFile(file, { exts: ["woff2"] }),
        form: {
          fields: (file) => {
            const nameInput = E("input", {
              type: "text",
              class: "cbi-input-text",
              placeholder: _("Font family name, e.g. MiSans"),
              value: familyFromFilename(file.name),
            });
            const slotSelect = E(
              "select",
              { class: "cbi-input-select" },
              [
                E("option", { value: "sans" }, _("Sans-Serif")),
                E("option", { value: "mono" }, _("Monospace")),
              ],
            );
            return {
              rows: [
                { label: _("Name"), control: nameInput },
                { label: _("Slot"), control: slotSelect },
              ],
              value: () => ({
                name: nameInput.value.trim(),
                slot: slotSelect.value,
              }),
              valid: () => !!nameInput.value.trim(),
              setDisabled: (disabled) => {
                nameInput.disabled = disabled;
                slotSelect.disabled = disabled;
              },
            };
          },
        },
        upload: (file, meta, onProgress) =>
          assetUpload
            .uploadToRouter({ tmpPath: FONT_TMP_PATH, file, onProgress })
            .then(() =>
              L.resolveDefault(callUploadFont(meta.slot, meta.name), {}),
            )
            .then((ret) => {
              if (ret?.result === 0) window.location.reload();
              else throw new Error(ret?.error || _("Unknown"));
            }),
      });

      return E("div", {}, [
        fontManager,
        E(
          "p",
          { style: "opacity:0.6;font-size:0.9em;margin:0.35em 0 0;" },
          _(
            "Keep custom font files as small as possible, as they are stored in the router's limited flash storage.",
          ),
        ),
      ]);
    };

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
        slot === "sans" ? _("Sans-Serif Typeface") : _("Monospace Typeface"),
      );
      presetOpt.description =
        slot === "sans"
          ? _(
              "Primary font for all interface text — headings, body, menus, forms, and tables.",
            )
          : _("Font for code, command output, and the system log viewer.");
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
        preset: font.custom ? "default" : font.name || "default",
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
              if (
                status.sans_status === "fallback" ||
                status.mono_status === "fallback"
              ) {
                ui.addNotification(
                  null,
                  E(
                    "p",
                    _(
                      "Typeface download failed after retries — the system font stack is in effect. Save again to retry.",
                    ),
                  ),
                  "warning",
                );
              }
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
        _("Preparing selected typefaces..."),
      );

      ui.showModal(_("Preparing Typography"), [statusNode]);

      return callPrepareFont(selected.sans, selected.mono, selected.sansStack)
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
              _("Typography preparation failed: ") +
                (err.message || String(err)),
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
      _("Brand Asset Library"),
      _(
        "Upload and manage images for icons, favicons, PWA assets, and the login background. Files are stored in <code>/www/luci-static/aurora/images/</code>.",
      ),
    );
    const assetSubsection = assetSection.subsection;

    const assetTableSo = assetSubsection.option(
      form.DummyValue,
      "_asset_table",
      " ",
    );
    assetTableSo.load = () => getIconsOnce();
    assetTableSo.cfgvalue = (section_id, data) => data?.icons || [];
    const ICON_EXTS = ["jpg", "jpeg", "png", "webp", "avif", "svg", "gif", "ico"];

    // render (not renderWidget): full-width mount, no cbi-value label row --
    // this section holds only the asset table. The font manager in the
    // Typography section uses renderWidget for the labeled-row wrapper.
    assetTableSo.render = function (option_index, section_id, in_table) {
      return this.load(section_id).then((data) => {
        const icons = this.cfgvalue(section_id, data);
        const sizes = data?.icon_sizes || {};
        const tmpPath = "/tmp/aurora_icon.tmp";

        const idleCallback = window.requestIdleCallback
          ? (fn) => window.requestIdleCallback(fn, { timeout: 2000 })
          : (fn) => setTimeout(fn, 100);

        const makePreview = (icon) => {
          const placeholder = E("div", {
            style:
              "width:34px;height:34px;border-radius:0.4em;" +
              "background:var(--surface-sunken);border:1px solid var(--hairline);",
          });
          idleCallback(() => {
            generateLqip("/luci-static/aurora/images/" + icon).then(
              (dataUrl) => {
                if (!dataUrl) return;
                placeholder.replaceWith(
                  E("img", {
                    src: dataUrl,
                    style:
                      "width:34px;height:34px;object-fit:cover;" +
                      "border-radius:0.4em;display:block;",
                    alt: "",
                  }),
                );
              },
            );
          });
          return placeholder;
        };

        const removeIcon = (icon) =>
          assetUpload.confirmDelete({
            title: _("Delete Brand Asset"),
            message: _(
              "Delete '%s' from /www/luci-static/aurora/images/? Theme settings that reference it may need updating.",
            ).format(icon),
          }).then((confirmed) => {
            if (!confirmed) return;
            ui.showModal(_("Deleting…"), [
              E("p", { class: "spinning" }, _("Please wait…")),
            ]);
            return L.resolveDefault(callRemoveIcon(icon), {}).then((ret) => {
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
            });
          });

        const iconManager = assetUpload.createAssetManager({
          badgeHeader: _("Type"),
          emptyText: _("No brand assets uploaded yet."),
          rows: icons.map((icon) => ({
            preview: makePreview(icon),
            name: icon,
            badge: assetUpload.extOf(icon).toUpperCase(),
            size: sizes[icon] || 0,
            onDelete: ui.createHandlerFn(this, () => removeIcon(icon)),
          })),
          bar: {
            hint: _("Drop image asset here, or click to browse"),
            sub: _("JPG · PNG · WebP · AVIF · SVG · GIF · ICO"),
            accept: "image/*,.svg,.ico",
          },
          checkFile: (file) =>
            assetUpload.checkFile(file, {
              exts: ICON_EXTS,
            }),
          form: {
            fields: (file) => {
              const nameInput = E("input", {
                type: "text",
                class: "cbi-input-text",
                value: file.name,
              });
              const collisionWarning = E(
                "p",
                {
                  style:
                    "color:var(--warning);font-size:0.9em;" +
                    "margin:0.35em 0 0;display:none;",
                },
                "",
              );
              const updateCollisionWarning = () => {
                const v = nameInput.value.trim();
                if (v && icons.includes(v)) {
                  collisionWarning.textContent = _(
                    "Will replace the existing '%s'.",
                  ).format(v);
                  collisionWarning.style.display = "";
                } else {
                  collisionWarning.style.display = "none";
                }
              };
              nameInput.addEventListener("input", updateCollisionWarning);
              updateCollisionWarning();
              const noteEl = E(
                "div",
                {
                  style:
                    "font-size:0.82em;color:var(--text-muted);" +
                    "opacity:0.8;margin-top:0.35em;",
                },
                _(
                  "Name it login-bg.* to use it as the login page background.",
                ),
              );
              return {
                rows: [
                  {
                    label: _("Filename (with extension)"),
                    control: E("div", {}, [
                      nameInput,
                      collisionWarning,
                      noteEl,
                    ]),
                  },
                ],
                value: () => ({ name: nameInput.value.trim() }),
                valid: () => {
                  const v = nameInput.value.trim();
                  return (
                    !!v &&
                    !v.includes("/") &&
                    !v.includes("..") &&
                    ICON_EXTS.includes(assetUpload.extOf(v))
                  );
                },
                setDisabled: (disabled) => {
                  nameInput.disabled = disabled;
                },
              };
            },
          },
          upload: (file, meta, onProgress) =>
            assetUpload
              .uploadToRouter({ tmpPath, file, onProgress })
              .then(() => L.resolveDefault(callUploadIcon(meta.name), {}))
              .then((ret) => {
                if (ret?.result === 0) {
                  if (/^login-bg\./i.test(meta.name)) {
                    localStorage.setItem("aurora.pending_bg", meta.name);
                  }
                  window.location.reload();
                } else {
                  throw new Error(ret?.error || _("Unknown"));
                }
              }),
        });

        return E("div", { "data-name": this.option }, [iconManager]);
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
        "Assign uploaded images to icons, favicons, PWA metadata, and the login background. Saved on Save or Save & Apply.",
      ),
    );
    const logoSubsection = logoSection.subsection;

    so = logoSubsection.option(form.ListValue, "logo_svg", _("Logo (SVG)"));
    so.description = _("SVG mark for the browser tab and login page.");
    so.default = "logo.svg";
    so.rmempty = false;
    so.load = makeIconListLoader(isImageFile);

    so = logoSubsection.option(
      form.ListValue,
      "favicon_png",
      _("Favicon (PNG)"),
    );
    so.description = _("PNG fallback when SVG favicons are unsupported.");
    so.rmempty = true;
    so.load = makeIconListLoader((icon) => PNG_NAME_RE.test(icon), {
      prepend: [["", _("(None)")]],
    });

    so = logoSubsection.option(
      form.ListValue,
      "favicon_ico",
      _("Favicon (ICO / Legacy)"),
    );
    so.description = _("Legacy ICO favicon fallback.");
    so.default = "favicon.ico";
    so.rmempty = false;
    so.load = makeIconListLoader((icon) => ICO_NAME_RE.test(icon));

    const pwaIconSlots = [
      [
        "pwa_apple_touch",
        _("Apple Touch Icon"),
        "apple-touch-icon.png",
        _("Home Screen icon for iOS and iPadOS."),
      ],
      [
        "pwa_icon_192",
        _("App Icon 192×192"),
        "app-icon-192x192.png",
        _("192×192 icon for the installable web app manifest."),
      ],
      [
        "pwa_icon_512",
        _("App Icon 512×512"),
        "app-icon-512x512.png",
        _("512×512 icon for the installable web app manifest."),
      ],
    ];

    pwaIconSlots.forEach(function ([key, label, defaultVal, description]) {
      so = logoSubsection.option(form.ListValue, key, label);
      so.description = description;
      so.default = defaultVal;
      so.rmempty = false;
      so.load = makeIconListLoader(
        (icon) => isImageFile(icon) && !/\.svg$/i.test(icon),
      );
    });

    so = logoSubsection.option(
      form.ListValue,
      "struct_login_bg",
      _("Login Background"),
    );
    so.description = _("Full-screen login page background; use a wide image.");
    so.rmempty = true;
    so.load = makeIconListLoader(
      (icon) => isImageFile(icon) && !icon.endsWith(".svg"),
      {
        prepend: [["", _("None")]],
        valueForIcon: toLoginBgUrl,
      },
    );
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
      _("Shortcut Toolbar"),
      _(
        "Floating shortcut launcher shown along the right edge of the interface.",
      ),
    );
    const toolbarSubsection = toolbarSection.subsection;

    so = toolbarSubsection.option(
      form.Flag,
      "toolbar_enabled",
      _("Show Shortcut Toolbar"),
    );
    so.description = _("Show the floating launcher on all pages.");
    so.default = "1";
    so.rmempty = false;

    so = toolbarSubsection.option(
      form.SectionValue,
      "_toolbar_items",
      form.GridSection,
      "toolbar_item",
      _("Toolbar Shortcuts"),
      _("Add shortcuts, assign icons, and drag rows to reorder them."),
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

    so = toolbarGrid.option(form.Value, "title", _("Shortcut Label"));
    so.rmempty = false;
    so.placeholder = _("e.g., Network Interfaces");
    so.validate = (section_id, value) =>
      !value?.trim() ? _("Enter a shortcut label") : true;

    so = toolbarGrid.option(form.Value, "url", _("Shortcut URL"));
    so.rmempty = false;
    so.placeholder = "/cgi-bin/luci/admin/...";
    so.validate = (section_id, value) =>
      !value?.trim() ? _("Enter a LuCI shortcut URL") : true;

    so = toolbarGrid.option(form.ListValue, "icon", _("Icon"));
    so.rmempty = false;
    so.load = makeIconListLoader(() => true, {
      empty: [["", _("(No icons uploaded)")]],
    });
    so.validate = (section_id, value) =>
      !value?.trim() ? _("Choose an uploaded icon for this shortcut") : true;

    return m.render().then((mapNode) => {
      colorEditor.attach();
      enhanceColorTokenGroups(mapNode);
      enhanceDerivedFold(mapNode);

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

      // Fire and forget: the capsule appears when the answer arrives, and if
      // it never does the header simply stays as it is.
      checkForUpdates().then(showUpdateCapsule);

      const notice = buildFeedNotice();
      return notice ? E("div", {}, [notice, mapNode]) : mapNode;
    });

  },
});
