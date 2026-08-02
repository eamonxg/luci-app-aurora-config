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
- The tooling under `scripts/` runs under Node with **zero dependencies**:
  `sync-tokens.mjs` vendors prebuilt artifacts from `@eamonxg/luci-theme-tokens`
  as plain copies (no local derivation), and `gen-presets.mjs` just formats
  `scripts/aurora-presets.json` into UCI option lines — no `npm install`, no
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
    ├── color-tokens.conf               # Ordered token key list for the backend — GENERATED
    └── font-presets.conf               # Font preset manifest (Fontsource packages + pinned versions) — GENERATED

scripts/sync-tokens.mjs                  # Vendors tokens.global.js + color-tokens.conf + aurora-presets.json (resolved preset hex) from @eamonxg/luci-theme-tokens, stamps TOKENS_ENGINE_VERSION into theme.js, then runs gen-presets
scripts/gen-presets.mjs                  # Regenerates *.template from scripts/aurora-presets.json (formatting only, no derivation)
scripts/aurora-presets.json              # Resolved preset hex values, vendored by sync-tokens.mjs — GENERATED
scripts/gen-font-presets.mjs             # Regenerates font-presets.conf (curated manifest lives in this file)
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
from the `@eamonxg/luci-theme-tokens` npm package**, vendored by
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

The token model lives in one npm package:

- **`@eamonxg/luci-theme-tokens`**
  ([repo](https://github.com/eamonxg/luci-theme-tokens)) — an independent repo
  with its own semver, published from its own root. It owns the engine (the
  five operators + spec-driven resolver, also exported standalone as
  `@eamonxg/luci-theme-tokens/engine`), the aurora spec (`aurora/spec.js` /
  `aurora/defaults.js` / `aurora/presets.js`), **and all derivation** — its
  `build.mjs` resolves every derived token and every built-in preset at
  *package* build time and ships the results as prebuilt `dist/aurora/`
  artifacts. `luci-theme-aurora` and this repo are both just consumers of the
  prebuilt output; neither derives anything locally anymore.

This repo **vendors** that package's `dist/aurora/` output by the exact
version pinned in `package.json` — `scripts/sync-tokens.mjs` copies three
files verbatim, no local derivation:

- `utils/tokens.global.js` ← `dist/aurora/tokens.global.js` — the browser
  global, still used by `theme.js` for live preview / on-save recompute.
- `root/usr/share/aurora/color-tokens.conf` ← `dist/aurora/color-tokens.conf`
  — the ordered key list the backend (`luci.aurora`) reads at runtime.
- `scripts/aurora-presets.json` ← `dist/aurora/presets.json` — every built-in
  preset, fully resolved to runtime hex, for **all 5** presets × light/dark.
- `view/aurora/theme.js` — only the `TOKENS_ENGINE_VERSION` constant, stamped
  from the vendored package's `package.json` version. `theme.js` appends it as
  `?v=` when loading `tokens.global.js`, so a version bump busts the browser's
  HTTP cache.

It then reruns `gen-presets.mjs`, which is a pure formatter: it reads
`scripts/aurora-presets.json` and injects `option light_<key>` /
`option dark_<key>` lines into `root/usr/share/aurora/*.template`, preserving
each template's non-color tail (`struct_*`, toolbar, etc.). It performs no
color math and does not load `tokens.global.js` — all values are already
resolved upstream.

`sync-tokens.mjs` resolves the package from three sources, in order:

1. `--local <path>` — a local `luci-theme-tokens` checkout, for iterating on
   an unreleased spec (run `npm install` + `node build.mjs` there first).
2. **npm registry** — the version pinned in `package.json` devDependencies;
   this is the normal path.
3. **sibling checkout** `../luci-theme-tokens` — fallback when the registry is
   unreachable; logs a warning since the output may not match the pin exactly.

All vendored artifacts are committed, so nothing downstream (CI, SDK build,
device) needs npm or the luci-theme-tokens repo. The pinned version doubles as
the compatibility statement: it names the luci-theme-tokens release this app
targets.

Drift is caught in three layers:

1. `theme.js` joins its UI metadata with the registry at load time and throws
   on missing/stale entries (`buildColorTokenTables`).
2. `tests/theme-token-sync.test.mjs` re-runs `sync-tokens.mjs --check` against
   the registry (the check also covers the `TOKENS_ENGINE_VERSION` stamp in
   `theme.js`, and a dedicated test asserts it matches the engine header).
3. `.github/workflows/token-sync-check.yml` runs the same check in CI (push/PR
   and weekly); Renovate/Dependabot can bump the pin when luci-theme-tokens
   releases.

Consumers of `tokens.global.js` at runtime:

1. **Frontend** — `theme.js` loads it for live preview, on-save computation,
   and the ordered token tables (`COLOR_TOKENS` et al.).

(`scripts/gen-presets.mjs` no longer loads it — see above; the presets it
emits come straight from `scripts/aurora-presets.json`.)

---

## 4. Recipes

### A. Retune a preset / add a new one

Preset ownership moved upstream in `@eamonxg/luci-theme-tokens` 2.0.0: the
`PRESETS` map now lives in that package's `aurora/presets.js`, and its
`build.mjs` resolves every preset to hex and ships it as
`dist/aurora/presets.json`. This repo no longer computes preset colors —
`gen-presets.mjs` only formats whatever `scripts/aurora-presets.json` says.

1. `luci-theme-tokens` repo: edit the `PRESETS` map in `aurora/presets.js`
   (each preset specifies only the **10 inputs** × light/dark), `npm test`.
2. Tag `vX.Y.Z`, push — CI auto-publishes.
3. `config` (here): bump the pin in `package.json` → `node
   scripts/sync-tokens.mjs` — refreshes `scripts/aurora-presets.json` and
   reruns `gen-presets.mjs`, which rewrites `root/usr/share/aurora/*.template`
   in place, preserving each template's non-color tail (`struct_*`, toolbar,
   etc.) → commit.
   To iterate on an unreleased preset: `node scripts/sync-tokens.mjs --local
   ../luci-theme-tokens`.
4. A brand-new preset also needs:
   - a new `root/usr/share/aurora/<name>.template` file in this repo (copy an
     existing one — `gen-presets.mjs` only rewrites templates that already
     exist, it never creates one)
   - `theme.js` → `buildPresetOptions()` (dropdown entry)
   - `luci.aurora` → `resolve_preset_path()` (name → template path)
   - `80_aurora` → template fallback chain (optional)

### B. Add or change a color token

> The token spec's single source of truth is the standalone
> `luci-theme-tokens` repo's `aurora/spec.js`/`aurora/defaults.js`, released
> as `@eamonxg/luci-theme-tokens`; everything here is vendored from that
> package.

1. `luci-theme-tokens` repo: edit `aurora/spec.js`/`aurora/defaults.js`,
   `npm test`.
2. Tag `vX.Y.Z`, push — CI auto-publishes.
3. `theme`: bump `.dev/package.json` → `npm install` → `npm run build`.
4. `config` (here): bump the pin in `package.json` → `npm run sync-tokens` —
   refreshes `tokens.global.js`, `color-tokens.conf`, and
   `scripts/aurora-presets.json` (and, via `gen-presets.mjs`, the preset
   templates) in one go (if there's a new token, follow the test prompts to
   fill in `theme.js` copy) → commit.
   To iterate on an unreleased spec: `node scripts/sync-tokens.mjs --local
   ../luci-theme-tokens`.
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
# pinned luci-theme-tokens package)
node --test tests/*.test.mjs

# Generated artifacts in sync with the pinned luci-theme-tokens package?
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
| `upload_font` / `remove_font` | Custom (user-uploaded) font management |
| `get_installed_versions` / `check_updates` / `download_package` / `install_package` | Versioning & one-click updates |

ACLs live in `root/usr/share/rpcd/acl.d/luci-app-aurora.json`; the menu entry in
`root/usr/share/luci/menu.d/luci-app-aurora.json`.

> `load_preset_snapshot()` validates that a template's `option (light|dark)_`
> line count equals `COLOR_TOKEN_KEYS count × 2`. The key list ships as
> `/usr/share/aurora/color-tokens.conf`, generated by `sync-tokens.mjs` from
> the same registry as the templates, so the two cannot drift apart.

---

## 7. Font system (v2)

Like the color templates, `root/usr/share/aurora/font-presets.conf` is a
**generated file — never hand-edit it**. Regenerate it with:

```bash
npm run gen-font-presets
```

`scripts/gen-font-presets.mjs` holds the curated manifest (Fontsource npm
package id, pinned version, and weights per preset). Running it re-downloads
every woff2 from jsDelivr, recomputes its sha256, and rewrites the conf —
commit the result.

### 7.1 `font-presets.conf` format

```
v2|generated-by-gen-font-presets|do-not-edit
font|<slot>|<name>|<label>|<source>|<family>|<stack>
file|<slot>|<name>|<weight>|<sha256>|<url_jsdelivr>|<url_npmmirror>
```

- One `font` line per preset (`slot` is `sans` or `mono`); built-in presets
  (`Lato`, `System UI`/`System Mono`) have no matching `file` lines.
- One `file` line per weight for Fontsource-backed presets, carrying the
  sha256 and both a jsDelivr and an npmmirror URL for the same file.
- `tests/font-presets.test.mjs` guards this format (field counts, slot/weight
  enums, sha256 shape, URL patterns) and runs as part of `npm test`.

### 7.2 Download pipeline (`luci.aurora`)

`prepare_font` downloads each required file **primary (jsDelivr) → fallback
(npmmirror)**, verifying the sha256 from `font-presets.conf` after each
attempt; a hash mismatch counts as a failure and triggers the fallback too.
The `@font-face` rule is always generated locally on the router — no remote
CSS is ever fetched or served to the browser. A slot's job status starts at
`ready` (queued/in progress) and settles on one of two final values:
`cached` (a verified file is in place — pure-stack presets with nothing to
download report this too) or `fallback` (download/verification failed and
the built-in face is used instead).

`fonts/preload.txt` is a single-line marker file consumed by the theme's
`header.ut` to emit `<link rel="preload">` for the active webfont:

- **Empty** — deliberately no preload (e.g. the built-in/system face is
  active, nothing to preload).
- **Absent** — an older layout that predates this marker; the theme falls
  back to preloading Lato.

### 7.3 Custom fonts

Users can upload their own woff2 via the `upload_font` RPC method (and remove
it via `remove_font`):

- Upload goes through cgi-io to `/tmp/aurora_font.tmp` (fonts) or
  `/tmp/aurora_icon.tmp` (brand assets), then a `receive_upload` gate in
  the rpcd script validates before anything touches flash:
  - shared size cap: 8MB (`MAX_UPLOAD`);
  - fonts: woff2 magic bytes (`wOF2`);
  - images: extension allowlist `jpg jpeg png webp avif svg gif ico`,
    path components rejected;
  - the gate deletes the tmp file on every rejection (front-end callers
    never clean up).
- Front-end plumbing lives in `utils/asset-upload.js` (dropzone, progress
  row, delete confirm, cgi-upload XHR); `view/aurora/theme.js` composes it
  for both the Custom Fonts and Brand Asset Library sections.
- Stored under `/www/luci-static/aurora/fonts/custom/<slot>-<slug>.{woff2,meta,face}`
  (`.face` is the pre-rendered `@font-face` block, `.meta` carries the
  display family + font stack).
- Custom faces are always included in the combined `aurora-font.css`, and
  selection flows through the `struct_font_*` UCI stacks exactly like preset
  fonts.

---

## 8. Releasing

OpenWrt package metadata lives in the `Makefile`:

```
PKG_VERSION  # semantic version; bump at least a patch for breaking schema changes
PKG_RELEASE  # YYYYMMDD-style date
```

CI builds `.ipk` / `.apk` artifacts through the `build-luci-package` Action using
the OpenWrt SDK.

---

## 9. Troubleshooting cheat sheet

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
