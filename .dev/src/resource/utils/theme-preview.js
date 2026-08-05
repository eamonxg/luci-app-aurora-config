"use strict";
"require baseclass";

// Palette-painted mini previews for the Theme Store (gallery.js is the only
// caller: cards, detail drawer and share panel): a fake LuCI page drawn from
// a 4-key palette ({bg, surface, text, brand}).
// Geometry is static cssText; only sanitised
// colors vary, so untrusted hub palettes can never inject styles.
//
// SECURITY: a config's logo is a user-uploaded SVG served by the hub. It may
// only ever reach the page through <img src>, where SVG scripting does not
// run. Nothing in this package may put hub SVG text into the DOM -- not
// innerHTML, not DOMParser, not insertAdjacentHTML -- however thoroughly the
// hub sanitises it on upload. Defence in depth: the sanitiser is not the
// only thing standing between a shared config and script execution.

const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;

const safeHex = (value, fallback) =>
  HEX_RE.test(value || "") ? value : fallback;

const mixHex = (hex, pct) =>
  "color-mix(in srgb, " + hex + " " + pct + "%, transparent)";

// An <img> that silently degrades to `fallback` when the image cannot be
// loaded, keeping the slot it occupies exactly the same size either way.
// Callers pass the css of the box the fallback already fills, so has-logo,
// no-logo and failed-load are three states with identical geometry.
//
// No spinner and no skeleton on purpose: the store paints from a stale
// cached list whenever the hub is unreachable, and in that state every image
// request fails. A flash followed by a jump is worse than a plain colour
// block that was right from the first frame.
const logoImage = (url, fallback, styleCss) => {
  if (!url) return fallback;
  const img = E("img", { src: url, alt: "", style: styleCss });
  img.addEventListener("error", () => {
    if (img.parentNode) img.parentNode.replaceChild(fallback, img);
  });
  return img;
};

// opts.nav: "sidebar" draws a left rail; "mega-menu" draws the top bar plus
// the expanded panel that sits under it; anything else (notably "dropdown")
// draws the plain top bar. These are the three values validate_and_apply_hub_
// payload accepts, so the preview covers the whole enum.
//
// opts.logo: an absolute url for the config's logo_svg. The brand square is
// exactly where a logo shows up in the real chrome, so drawing it there is
// the whole change -- one node swapped for another of the same size. That is
// why this shape survives no-asset, has-asset and failed-load without moving
// a pixel, which matters: most shared configs carry no assets at all.
const buildMini = (pal, opts) => {
  const nav = (opts && opts.nav) || "top";
  const bg = safeHex(pal && pal.bg, "#f7fafc");
  const surface = safeHex(pal && pal.surface, "#ffffff");
  const text = safeHex(pal && pal.text, "#121a22");
  const brand = safeHex(pal && pal.brand, "#0086bf");

  const bar = (width, pct, extra) => {
    const el = E("span", {
      style:
        "height:22%;border-radius:99px;width:" + width + ";" + (extra || ""),
    });
    el.style.background = mixHex(text, pct);
    return el;
  };

  const row = (width) => {
    const el = E("div", {
      style:
        "height:5px;border-radius:99px;margin-bottom:4%;width:" + width + ";",
    });
    el.style.background = mixHex(text, 24);
    return el;
  };

  const card = (children) => {
    const el = E(
      "div",
      { style: "border-radius:8px;padding:4%;margin-bottom:5%;" },
      children,
    );
    el.style.background = surface;
    el.style.border = "1px solid " + mixHex(text, 10);
    return el;
  };

  const DOT_CSS = "width:7%;aspect-ratio:1;border-radius:25%;flex:none;";
  const brandSquare = E("span", { style: DOT_CSS });
  brandSquare.style.background = brand;
  const dot = logoImage(
    (opts && opts.logo) || "",
    brandSquare,
    DOT_CSS + "object-fit:contain;",
  );

  const title = E("div", {
    style:
      "height:8px;max-height:14%;border-radius:99px;width:45%;margin-bottom:6%;",
  });
  title.style.background = mixHex(text, 72);

  const btn = E("span", {
    style: "display:inline-block;width:26%;height:12px;border-radius:99px;",
  });
  btn.style.background = brand;

  const content = [card([title, row("90%"), row("70%"), btn]), card([row("85%"), row("60%")])];

  let chromeNodes;
  let main;
  if (nav === "sidebar") {
    const rail = E(
      "div",
      {
        style:
          "position:absolute;left:0;top:0;bottom:0;width:22%;display:flex;" +
          "flex-direction:column;gap:8%;padding:6% 4%;box-sizing:border-box;",
      },
      [dot, bar("80%", 28, "height:7%;"), bar("90%", 28, "height:7%;"), bar("70%", 28, "height:7%;")],
    );
    rail.children[2].style.background = brand;
    rail.style.background = surface;
    rail.style.borderRight = "1px solid " + mixHex(text, 12);
    chromeNodes = [rail];
    main = E(
      "div",
      { style: "position:absolute;left:27%;top:7%;right:5%;bottom:0;" },
      content,
    );
  } else {
    const top = E(
      "div",
      {
        style:
          "position:absolute;left:0;right:0;top:0;height:16%;display:flex;" +
          "align-items:center;gap:4%;padding:0 4%;box-sizing:border-box;",
      },
      [dot, bar("18%", 55), bar("12%", 34), bar("12%", 34)],
    );
    top.style.background = surface;
    top.style.borderBottom = "1px solid " + mixHex(text, 12);
    chromeNodes = [top];

    // A mega menu is only distinguishable from a dropdown once its panel is
    // open, so the thumbnail draws it open.
    if (nav === "mega-menu") {
      const panel = E(
        "div",
        {
          style:
            "position:absolute;left:0;right:0;top:16%;height:13%;display:flex;" +
            "align-items:center;gap:3%;padding:0 4%;box-sizing:border-box;",
        },
        [
          bar("10%", 30, "height:26%;"),
          bar("14%", 30, "height:26%;"),
          bar("9%", 30, "height:26%;"),
          bar("12%", 30, "height:26%;"),
        ],
      );
      panel.style.background = surface;
      panel.style.borderBottom = "1px solid " + mixHex(text, 12);
      chromeNodes.push(panel);
    }

    main = E(
      "div",
      {
        style:
          "position:absolute;left:5%;top:" +
          (nav === "mega-menu" ? "37%" : "24%") +
          ";right:5%;bottom:0;",
      },
      content,
    );
  }

  const root = E(
    "div",
    { style: "position:absolute;inset:0;overflow:hidden;" },
    chromeNodes.concat([main]),
  );
  root.style.background = bg;
  return root;
};

// Light/dark diagonal split: two minis, the dark one clipped to the right.
const buildDuo = (palette, opts) => {
  const dark = buildMini((palette && palette.dark) || {}, opts);
  dark.style.clipPath = "polygon(58% 0, 100% 0, 100% 100%, 42% 100%)";
  return E("div", { style: "position:relative;width:100%;height:100%;" }, [
    buildMini((palette && palette.light) || {}, opts),
    dark,
  ]);
};

return baseclass.extend({
  safeHex,
  mixHex,
  logoImage,
  buildMini,
  buildDuo,
});
