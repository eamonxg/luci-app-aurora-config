/**
 * Aurora design-token engine (browser port).
 *
 * MUST stay in sync with luci-theme-aurora/.dev/tokens/{engine,spec,defaults}.js
 * -- the theme bakes these same derivations into _tokens.css at build time, so
 * the config UI has to reproduce them to override the baked defaults.
 *
 * Depends on the global `Color` from utils/color.global.js (load it first).
 * Exposes the global `AuroraTokens`.
 */
var AuroraTokens = (function () {
  "use strict";

  // 10 editable inputs (must match tokens/spec.js INPUTS order).
  var INPUTS = [
    "bg",
    "surface",
    "text",
    "brand",
    "on_brand",
    "link",
    "info",
    "warning",
    "success",
    "danger",
  ];

  // Operators: ['mix',a,b,p] ['shade',a,dl] ['set',a,L,C]
  //            ['alpha',a,p] ['const',str]   ('var:NAME' aliases another token)
  var DERIVATIONS = {
    light: {
      text_muted: ["mix", "text", "bg", 0.62],
      text_subtle: ["mix", "text", "bg", 0.48],
      surface_sunken: ["shade", "bg", -0.01],
      surface_overlay: ["shade", "bg", 0.016],
      hairline: ["alpha", "text", 0.08],
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
      mega_menu_bg: ["alpha", "surface_overlay", 0.66],
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
      progress_start: ["const", "oklch(0.4318 0.0865 166.91)"],
      progress_end: ["const", "oklch(0.621 0.145 189.632)"],
      info_surface: ["set", "info", 0.32, 0.05],
      warning_surface: ["set", "warning", 0.33, 0.06],
      success_surface: ["set", "success", 0.3, 0.05],
      danger_surface: ["set", "danger", 0.32, 0.08],
      danger_surface_hover: ["shade", "danger_surface", 0.04],
      scrim: ["const", "oklch(0 0 0 / 0.6)"],
      mega_menu_bg: ["alpha", "surface_overlay", 0.62],
    },
  };

  var DERIVED_KEYS = Object.keys(DERIVATIONS.light);

  // --- engine primitives (mirror tokens/engine.js) ---
  var C = function (v) {
    return v instanceof Color ? v : new Color(v);
  };

  // color-mix(in oklab, a p%, b) => position toward b is (1 - p)
  var mix = function (a, b, p) {
    return Color.mix(C(a), C(b), 1 - p, {
      space: "oklab",
      outputSpace: "oklch",
    });
  };

  var shade = function (a, dl) {
    var c = C(a).to("oklch");
    c.coords[0] += dl;
    return c;
  };

  var set = function (a, L, Ch) {
    var c = C(a).to("oklch");
    c.coords[0] = L;
    c.coords[1] = Ch;
    return c;
  };

  var alpha = function (a, p) {
    var c = C(a).to("oklch");
    c.alpha = p;
    return c;
  };

  var konst = function (s) {
    return C(s).to("oklch");
  };

  var toOklch = function (v) {
    return C(v).to("oklch").toString({ precision: 4, format: "oklch" });
  };

  // Resolve one mode. inputs: {name: oklchString}. Returns flat {name: string}.
  function resolve(mode, inputs) {
    var derivs = DERIVATIONS[mode];
    var resolved = {};
    for (var i = 0; i < INPUTS.length; i++) {
      var name = INPUTS[i];
      if (inputs[name] !== undefined) resolved[name] = inputs[name];
    }

    function ref(name) {
      if (resolved[name] === undefined) compute(name);
      return resolved[name];
    }

    function compute(name) {
      var rule = derivs[name];
      if (!rule) throw new Error("unknown derived token: " + name);
      var op = rule[0];
      var color;
      switch (op) {
        case "mix":
          color = mix(ref(rule[1]), ref(rule[2]), rule[3]);
          break;
        case "shade":
          color = shade(ref(rule[1]), rule[2]);
          break;
        case "set":
          color = set(ref(rule[1]), rule[2], rule[3]);
          break;
        case "alpha":
          color = alpha(ref(rule[1]), rule[2]);
          break;
        case "const":
          if (rule[1].indexOf("var:") === 0) {
            resolved[name] = ref(rule[1].slice(4));
            return;
          }
          color = konst(rule[1]);
          break;
        default:
          throw new Error("unknown op: " + op);
      }
      resolved[name] = toOklch(color);
    }

    for (var k = 0; k < DERIVED_KEYS.length; k++) compute(DERIVED_KEYS[k]);
    return resolved;
  }

  return {
    INPUTS: INPUTS,
    DERIVED_KEYS: DERIVED_KEYS,
    resolve: resolve,
  };
})();
