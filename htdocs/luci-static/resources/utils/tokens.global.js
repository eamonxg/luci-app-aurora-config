/**
 * @eamonxg/aurora-tokens v1.0.0 -- GENERATED, DO NOT EDIT.
 * Aurora design-token engine (browser global). Built from spec.js/defaults.js
 * + engine.js by build-global.mjs. Depends on the global `Color`
 * (utils/color.global.js in luci-app-aurora-config); load that first.
 */
var AuroraTokens = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // global.js
  var global_exports = {};
  __export(global_exports, {
    DEFAULTS: () => DEFAULTS,
    DERIVATIONS: () => DERIVATIONS,
    DERIVED_KEYS: () => DERIVED_KEYS,
    INPUTS: () => INPUTS,
    resolve: () => resolve
  });

  // spec.js
  var DERIVATIONS = {
    light: {
      text_muted: ["mix", "text", "bg", 0.62],
      text_subtle: ["mix", "text", "bg", 0.48],
      surface_sunken: ["shade", "bg", -0.012],
      surface_overlay: ["shade", "bg", 0.016],
      hairline: ["alpha", "text", 0.13],
      hover_faint: ["shade", "bg", -0.04],
      brand_hover: ["shade", "brand", -0.06],
      brand_subtle: ["mix", "brand", "bg", 0.12],
      brand_subtle_hover: ["shade", "brand_subtle", -0.04],
      focus_ring: ["alpha", "brand", 0.6],
      progress_start: ["mix", "brand", "surface_sunken", 0.65],
      progress_end: ["const", "var:brand"],
      info_surface: ["set", "info", 0.94, 0.05],
      warning_surface: ["set", "warning", 0.95, 0.05],
      success_surface: ["set", "success", 0.94, 0.05],
      danger_surface: ["set", "danger", 0.94, 0.05],
      danger_surface_hover: ["shade", "danger_surface", -0.04],
      scrim: ["const", "oklch(0 0 0 / 0.6)"],
      // Fully opaque: a clean solid panel (Apple's #fafafc). Any translucency let
      // the dimmed curtain bleed through, greying the panel off the header tone
      // and leaking faint blurred page content into the empty columns. The header
      // lifts to this same colour when the menu opens (see _layout.css) so bar and
      // panel read as one continuous surface.
      mega_menu_bg: ["alpha", "surface_overlay", 1],
      // Mega-menu curtain: a real dimming layer. A near-page-light grey (the
      // earlier #e8e8ed attempt) only blurred without darkening, so the mask read
      // as absent. Black at a modest alpha actually dims the page; the now-opaque
      // panel + its shadow give a clean edge, so this no longer bands the way the
      // old translucent panel over a heavy scrim did. Lighter than the 0.6 modal
      // scrim — it's a menu backdrop, not a dialog.
      mega_menu_scrim: ["const", "oklch(0 0 0 / 0.32)"]
    },
    dark: {
      text_muted: ["mix", "text", "bg", 0.62],
      text_subtle: ["mix", "text", "bg", 0.42],
      surface_sunken: ["shade", "surface", -0.045],
      surface_overlay: ["shade", "surface", 0.02],
      hairline: ["alpha", "text", 0.1],
      hover_faint: ["alpha", "text", 0.05],
      brand_hover: ["shade", "brand", -0.05],
      brand_subtle: ["mix", "brand", "bg", 0.16],
      brand_subtle_hover: ["shade", "brand_subtle", 0.04],
      focus_ring: ["alpha", "brand", 0.6],
      // Derived from brand like light — not hardcoded — so the bar tracks the
      // active brand colour instead of a frozen teal.
      progress_start: ["mix", "brand", "surface_sunken", 0.65],
      progress_end: ["const", "var:brand"],
      info_surface: ["set", "info", 0.32, 0.05],
      warning_surface: ["set", "warning", 0.33, 0.06],
      success_surface: ["set", "success", 0.3, 0.05],
      danger_surface: ["set", "danger", 0.32, 0.08],
      danger_surface_hover: ["shade", "danger_surface", 0.04],
      scrim: ["const", "oklch(0 0 0 / 0.6)"],
      // Deeper than surface_overlay (23%): surface_sunken (16.5%) tracks Apple's
      // opened-panel #161617 (~18.5%). Fully opaque — a clean solid panel with no
      // curtain bleed; the header lifts to this colour on open (see _layout.css)
      // so bar and panel are one continuous surface.
      mega_menu_bg: ["alpha", "surface_sunken", 1],
      // Dark curtain stays a near-black dim (Apple's rgba(0,0,0,.4)); the dark
      // panel and dark page already share a tone, so this only needs to deepen.
      mega_menu_scrim: ["const", "oklch(0 0 0 / 0.5)"]
    }
  };

  // defaults.js
  var DEFAULTS = {
    light: {
      bg: "oklch(0.967 0.003 264)",
      surface: "oklch(1 0 0)",
      text: "oklch(0.21 0.02 264)",
      brand: "oklch(0.58 0.14 233)",
      on_brand: "oklch(1 0 0)",
      link: "oklch(0.74 0.238 322.16)",
      info: "oklch(0.45 0.12 255)",
      warning: "oklch(0.35 0.08 60)",
      success: "oklch(0.32 0.09 165)",
      danger: "oklch(0.35 0.12 25)"
    },
    dark: {
      bg: "oklch(0.13 0.018 264)",
      surface: "oklch(0.21 0.02 264)",
      text: "oklch(0.985 0.002 264)",
      brand: "oklch(0.6 0.13 188.745)",
      on_brand: "oklch(1 0 0)",
      link: "oklch(0.77 0.14 168)",
      info: "oklch(0.8 0.11 255)",
      warning: "oklch(0.82 0.13 80)",
      success: "oklch(0.72 0.13 158)",
      danger: "oklch(0.7 0.16 22)"
    }
  };

  // shim-color-global.js
  var shim_color_global_default = globalThis.Color;

  // engine.js
  var C = (v) => v instanceof shim_color_global_default ? v : new shim_color_global_default(v);
  var mix = (a, b, p) => shim_color_global_default.mix(C(a), C(b), 1 - p, { space: "oklab", outputSpace: "oklch" });
  var shade = (a, dl) => {
    const c = C(a).to("oklch");
    c.coords[0] += dl;
    return c;
  };
  var set = (a, L, Ch) => {
    const c = C(a).to("oklch");
    c.coords[0] = L;
    c.coords[1] = Ch;
    return c;
  };
  var alpha = (a, p) => {
    const c = C(a).to("oklch");
    c.alpha = p;
    return c;
  };
  var konst = (s) => C(s).to("oklch");
  var toOklch = (v) => C(v).to("oklch").toString({ precision: 4, format: "oklch" });

  // resolve.js
  function createResolver(derivations) {
    return function resolveTokens2(mode, inputs) {
      const derivs = derivations[mode];
      if (!derivs) throw new Error(`unknown mode: ${mode}`);
      const resolved = { ...inputs };
      const ref = (name) => {
        if (resolved[name] === void 0) compute(name);
        return resolved[name];
      };
      function compute(name) {
        const rule = derivs[name];
        if (!rule) throw new Error(`unknown derived token: ${name}`);
        const [op, ...args] = rule;
        let color;
        switch (op) {
          case "mix":
            color = mix(ref(args[0]), ref(args[1]), args[2]);
            break;
          case "shade":
            color = shade(ref(args[0]), args[1]);
            break;
          case "set":
            color = set(ref(args[0]), args[1], args[2]);
            break;
          case "alpha":
            color = alpha(ref(args[0]), args[1]);
            break;
          case "const":
            if (args[0].startsWith("var:")) {
              resolved[name] = ref(args[0].slice(4));
              return;
            }
            color = konst(args[0]);
            break;
          default:
            throw new Error(`unknown op: ${op}`);
        }
        resolved[name] = toOklch(color);
      }
      for (const name of Object.keys(derivs)) compute(name);
      return resolved;
    };
  }
  var resolveTokens = createResolver(DERIVATIONS);

  // global.js
  var INPUTS = Object.keys(DEFAULTS.light);
  var DERIVED_KEYS = Object.keys(DERIVATIONS.light);
  var resolve = resolveTokens;
  return __toCommonJS(global_exports);
})();
