# Development Guide

A getting-started guide for contributors new to `luci-app-aurora-config`. It
covers the big picture, the parts that are easy to get wrong, and recipes for
common tasks.

> **What this is.** The configuration app for the Aurora theme
> (`luci-theme-aurora`). It adds a LuCI admin page where users tune theme
> colors, layout, branding, and the toolbar, and update the theme/config
> packages with one click. This repo only owns the *configuration UI* and
> *writes settings into UCI* — the actual rendering lives in the theme package.

---

## 1. There is no build step

The project **ships source directly** — no Vite, webpack, or TypeScript
compilation.

- The frontend uses LuCI's `E()` DOM API (not React/Vue); the browser loads the
  raw `.js` files under `htdocs/` as-is.
- The backend is a single rpcd shell script.
- The only tooling, `scripts/gen-presets.mjs`, runs under Node with **zero
  dependencies** (it loads in-repo JS via `node:vm`) — no `npm install`, no
  bundler.

To test a change, sync `htdocs/` and `root/` to the matching paths on the
device, then reload the page or restart rpcd.

---

## 2. Repository layout

```
htdocs/luci-static/resources/
├── view/aurora/
│   ├── theme.js          # Main UI: color editor, layout, branding, toolbar (largest file)
│   └── version.js        # Version & update UI
└── utils/
    ├── color.global.js   # Vendored colorjs.io (color conversion; global `Color`)
    ├── tokens.global.js  # ★ Color derivation engine (global `AuroraTokens`) — GENERATED, do not edit
    └── version-api.js    # Version-check helpers

root/
├── etc/uci-defaults/80_aurora          # First-install setup + schema migration
├── usr/libexec/rpcd/luci.aurora        # Backend RPC (shell)
└── usr/share/aurora/
    ├── *.template                      # Five built-in color presets (UCI fragments) — GENERATED
    └── color-tokens.conf               # Ordered token key list for the backend — GENERATED

scripts/sync-tokens.mjs                  # Regenerates tokens.global.js + color-tokens.conf from the aurora-tokens repo's spec, then runs gen-presets
scripts/gen-presets.mjs                  # Regenerates *.template
Makefile                                 # OpenWrt package metadata (version lives here)
```

---

## 3. The color token system (core concepts)

This is the part most likely to trip you up. Read it before touching colors.

### 3.1 Inputs vs. derived tokens

The entire palette is driven by **10 editable inputs**; every other color is
**derived** from them.

| Kind | Count | Examples |
| --- | --- | --- |
| Inputs (user-editable) | 10 | `bg`, `surface`, `text`, `brand`, `on_brand`, `link`, `info`, `warning`, `success`, `danger` |
| Derived (computed) | 20 | `text_muted`, `surface_sunken`, `brand_hover`, `brand_subtle`, `focus_ring`, `*_surface`, `scrim`, `mega_menu_bg`, … |

The derivation rules (`mix` / `shade` / `set` / `alpha` / `const`) live in the
theme's token spec. **`utils/tokens.global.js` is the prebuilt browser bundle
from the `@eamonxg/aurora-tokens` npm package**, vendored by
`scripts/sync-tokens.mjs` — never edit it by hand (see §3.4).

### 3.2 Why the config app computes derived tokens itself

The theme authors derived tokens in `_tokens.css` **at build time** as flat
color literals — they no longer reference `var()` / `color-mix()`. The compiled
`main.css` is emitted as hex fallbacks plus `lab(...)` values for compatible
browsers. As a result, **overriding `--brand` alone does not cascade** into
`--brand-hover`, `--focus-ring`, and friends.

So the config app's strategy is: the user edits the 10 inputs → the frontend
expands them into all 30 values via `AuroraTokens.resolve()` → **all 30 are
written to UCI as hex/hex8 runtime colors** → the theme's template injects them,
overriding the baked defaults wholesale. Advanced users may also override
individual derived values; blank derived fields continue to follow the generated
values.

### 3.3 End-to-end data flow

```
User edits input colors in the UI
        │
        ▼
theme.js: persistDerivedTokens()
  runs AuroraTokens.resolve(mode, <10 inputs>) for light + dark
  writes 30 light_<key> / dark_<key> hex entries into UCI (aurora.theme)
        │  on save
        ▼
/etc/config/aurora             ← UCI storage
        │
        ▼
Theme template header.ut, at page render:
  emits each light_*  as :root { --<key> }
  emits each dark_*   as [data-darkmode=true] { --<key> }
        │
        ▼
Overrides the baked defaults in _tokens.css → user's palette renders
```

> ⚠️ `header.ut` injects **every** `light_*` / `dark_*` key indiscriminately.
> Stale keys left in UCI become dangling overrides pointing at CSS variables
> that no longer exist. Pruning them is the job of schema migration (see §5).

### 3.4 Single source of truth

The token model is layered across two npm packages (mechanism vs. policy):

- **`@eamonxg/token-engine`** ([repo](https://github.com/eamonxg/token-engine))
  — the five operators + spec-driven resolver, shared by luci-theme-aurora,
  luci-theme-shadcn, and the aurora-tokens package.
- **`@eamonxg/aurora-tokens`** ([repo](https://github.com/eamonxg/aurora-tokens))
  — an independent repo with its own semver, published from its own root. It
  owns the aurora spec (`spec.js`/`defaults.js`) and ships the prebuilt
  browser global `dist/tokens.global.js` (engine + spec, with colorjs.io
  aliased to the page's global `Color`). `luci-theme-aurora` and this repo are
  both just consumers of it.

This repo **vendors** that package by the exact version pinned in
`package.json` — `scripts/sync-tokens.mjs` refreshes:

- `utils/tokens.global.js` — the package's `dist/tokens.global.js`, verbatim.
- `root/usr/share/aurora/color-tokens.conf` — the ordered key list the backend
  (`luci.aurora`) reads at runtime, derived from the vendored engine.
- `root/usr/share/aurora/*.template` — regenerated via `gen-presets.mjs`, which
  loads `tokens.global.js` in a `node:vm` sandbox.

All vendored artifacts are committed, so nothing downstream (CI, SDK build,
device) needs npm or the aurora-tokens repo. The pinned version doubles as the
compatibility statement: it names the aurora-tokens release this app targets.

Drift is caught in three layers:

1. `theme.js` joins its UI metadata with the registry at load time and throws
   on missing/stale entries (`buildColorTokenTables`).
2. `tests/theme-token-sync.test.mjs` re-runs `sync-tokens.mjs --check` against
   the registry.
3. `.github/workflows/token-sync-check.yml` runs the same check in CI (push/PR
   and weekly); Renovate/Dependabot can bump the pin when aurora-tokens
   releases.

Consumers of `tokens.global.js` at runtime:

1. **Frontend** — `theme.js` loads it for live preview, on-save computation,
   and the ordered token tables (`COLOR_TOKENS` et al.).
2. **Generator** — `scripts/gen-presets.mjs` loads it via `node:vm` to produce
   the `*.template` files (the default preset comes from its `DEFAULTS`).

---

## 4. Recipes

### A. Retune a preset / add a new one

1. Edit the `PRESETS` map in `scripts/gen-presets.mjs` (each preset specifies
   only the **10 inputs** × light/dark).
2. Regenerate:
   ```bash
   node scripts/gen-presets.mjs
   ```
   It computes the derived values and rewrites
   `root/usr/share/aurora/*.template`, preserving the non-color tail
   (`struct_*`, toolbar, etc.).
3. A brand-new preset also needs wiring in:
   - `theme.js` → `buildPresetOptions()` (dropdown entry)
   - `luci.aurora` → `resolve_preset_path()` (name → template path)
   - `80_aurora` → template fallback chain (optional)

### B. Add or change a color token

> The token spec's single source of truth is the standalone `aurora-tokens`
> repo's `spec.js`/`defaults.js`, released as `@eamonxg/aurora-tokens`;
> everything here is vendored from that package.

1. `aurora-tokens` repo: edit `spec.js`/`defaults.js`, `npm test`.
2. Tag `vX.Y.Z`, push — CI auto-publishes.
3. `theme`: bump `.dev/package.json` → `npm install` → `npm run build`.
4. `config` (here): bump the pin in `package.json` → `npm run sync-tokens` —
   refreshes `tokens.global.js`, `color-tokens.conf`, and the preset templates
   in one go (if there's a new token, follow the test prompts to fill in
   `theme.js` copy) → commit.
   To iterate on an unreleased spec: `node scripts/sync-tokens.mjs --local
   ../aurora-tokens`.
3. For a new token, add its UI copy in `theme.js` →
   `COLOR_TOKEN_METADATA` / `DERIVED_COLOR_TOKEN_METADATA` (and a group entry if
   needed). The tests and `buildColorTokenTables()` fail loudly until every
   registry token has metadata.
4. **Bump `SCHEMA_VERSION` in `80_aurora`** (see §5).

### C. Verify without a device

```bash
# JS syntax
node --check htdocs/luci-static/resources/view/aurora/theme.js
node --check htdocs/luci-static/resources/utils/tokens.global.js

# Shell syntax
sh -n root/usr/libexec/rpcd/luci.aurora
sh -n root/etc/uci-defaults/80_aurora

# Full test suite (includes a generated-artifact check against the
# pinned aurora-tokens package)
node --test tests/*.test.mjs

# Generated artifacts in sync with the pinned aurora-tokens package?
node scripts/sync-tokens.mjs --check
```

---

## 5. Schema migration & upgrades

When the *meaning* of a color token changes incompatibly, snapshots in an
existing `/etc/config/aurora` go stale — they can inject invisible or wrong
colors, or leave behind obsolete keys. This is handled in
`root/etc/uci-defaults/80_aurora`:

- `SCHEMA_VERSION` at the top is the current version; the header comments record
  what each version (v2 / v3 / v4 / …) changed.
- On upgrade, `migrate_color_schema()` compares the stored `config_version`; on a
  mismatch it calls `reseed_colors_from_template()`, which:
  - re-sets every `light_*` / `dark_*` key from the **current template**, and
  - **deletes** any key absent from the template — this is what clears stale
    state.
- On a fresh install it simply copies the template to `/etc/config/aurora`.

**Any change that alters the key set or token semantics must bump
`SCHEMA_VERSION` and add a comment** — otherwise existing users never run the
migration on upgrade.

---

## 6. Backend RPC reference (`luci.aurora`)

A shell rpcd script exposing the object `luci.aurora`. The frontend calls it via
`rpc.declare({ object: "luci.aurora", method: ... })`. The full method list is
the `case "$1" in "list")` block at the end of the script. Common methods:

| Method | Purpose |
| --- | --- |
| `get_init_data` | Read first-paint data in one RPC: installed versions, font presets, icons, and the active preset snapshot |
| `get_theme_preset` | Read a preset snapshot for UI placeholders and comparison |
| `apply_theme_preset` | Apply a preset (writes color sets; other theme areas use the default profile) |
| `export_config` / `import_config` | Configuration import/export |
| `list_icons` / `upload_icon` / `remove_icon` | Icon management |
| `prepare_font` / `get_font_presets` / `get_font_status` | Font handling |
| `get_installed_versions` / `check_updates` / `download_package` / `install_package` | Versioning & one-click updates |

ACLs live in `root/usr/share/rpcd/acl.d/luci-app-aurora.json`; the menu entry in
`root/usr/share/luci/menu.d/luci-app-aurora.json`.

> `load_preset_snapshot()` validates that a template's `option (light|dark)_`
> line count equals `COLOR_TOKEN_KEYS count × 2`. The key list ships as
> `/usr/share/aurora/color-tokens.conf`, generated by `sync-tokens.mjs` from
> the same registry as the templates, so the two cannot drift apart.

---

## 7. Releasing

OpenWrt package metadata lives in the `Makefile`:

```
PKG_VERSION  # semantic version; bump at least a patch for breaking schema changes
PKG_RELEASE  # YYYYMMDD-style date
```

CI builds `.ipk` / `.apk` artifacts through the `build-luci-package` Action using
the OpenWrt SDK.

---

## 8. Troubleshooting cheat sheet

- **Changed `brand` but hover/status colors don't follow?** Derived tokens
  weren't written to UCI — check that `tokens.global.js` loaded and that
  `persistDerivedTokens` ran on save.
- **Colors broken or invisible text after an upgrade?** Stale keys weren't
  pruned — confirm `SCHEMA_VERSION` was bumped and the migration ran.
- **Applying a preset fails?** The backend `COLOR_TOKEN_KEYS` count no longer
  matches the template line count.
- **Injection has no effect (variable name mismatch)?** Config keys (underscores)
  become hyphenated CSS variables on injection; they must match the `--xxx`
  names in the theme's `_tokens.css` exactly.
