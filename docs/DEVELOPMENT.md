# Development Guide

A getting-started guide for contributors new to `luci-app-aurora-config`. It
covers the big picture, the parts that are easy to get wrong, and recipes for
common tasks.

> **What this is.** The configuration app for the Aurora theme
> (`luci-theme-aurora`). It adds a LuCI admin page where users tune theme
> colors, layout, branding, and the toolbar, plus a Theme Store page to
> browse, apply, and share complete configurations with other users. This
> repo only owns the *configuration UI* and *writes settings into UCI* — the
> actual rendering lives in the theme package.

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
│   └── gallery.js        # Theme Store: browse/apply, share, and "my shares"
└── utils/
    ├── color.global.js   # Vendored colorjs.io (color conversion; global `Color`)
    ├── tokens.global.js  # ★ Color derivation engine (global `AuroraTokens`) — GENERATED, do not edit
    ├── hub-api.js         # rpc.declare wrappers for the hub_* RPC methods + list cache
    └── asset-upload.js   # Shared dropzone/upload widget (fonts, brand assets)

root/
├── etc/uci-defaults/80_aurora          # First-install setup + schema migration
├── etc/sysupgrade.conf.d/aurora-device # Preserves /etc/aurora/device.{key,hash} across sysupgrade
├── usr/libexec/rpcd/luci.aurora        # Backend RPC (shell)
└── usr/share/aurora/
    ├── *.template                      # Five built-in presets (UCI fragments). Colour block GENERATED; the layout/typography block below it is hand-authored
    ├── color-tokens.conf               # Ordered token key list for the backend — GENERATED
    └── font-presets.conf               # Font preset manifest (Fontsource packages + pinned versions) — GENERATED

htdocs/luci-static/resources/aurora/presets.json  # Browser copy of all five presets (hub payload shape) for the offline store cards — GENERATED
scripts/sync-tokens.mjs                  # Vendors tokens.global.js + color-tokens.conf + aurora-presets.json (resolved preset hex) from @eamonxg/luci-theme-tokens, stamps TOKENS_ENGINE_VERSION into theme.js, then runs gen-presets
scripts/gen-presets.mjs                  # Injects the colour block into *.template, reads each template's layout/typography back out, and writes htdocs/.../aurora/presets.json
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

A preset is a **whole look, not a palette**: its template carries the 62
colour options *and* a structural block — `nav_type`, `struct_spacing`,
`struct_radius_base`, `struct_content_width_centered`, `struct_font_sans`,
`struct_font_mono`, `toolbar_enabled` (the shell's `PRESET_STRUCT_KEYS`).
`apply_theme_preset` writes all of it. The two halves have different owners:

- **Colours** come from upstream. Preset ownership moved into
  `@eamonxg/luci-theme-tokens` 2.0.0: the `PRESETS` map lives in that
  package's `aurora/presets.js`, its `build.mjs` resolves every preset to hex
  and ships `dist/aurora/presets.json`, and `gen-presets.mjs` only formats
  whatever `scripts/aurora-presets.json` says.
- **Structure** is authored here, in the template itself. `sync-tokens.mjs`
  overwrites `scripts/aurora-presets.json` on every sync, so nothing this repo
  decides may live there.

To retune colours:

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

To retune the look, edit the structural block in
`root/usr/share/aurora/<name>.template` directly, then `npm run gen-presets`
(it re-reads the block into the browser copy). Two rules the tests enforce:

- Numeric values must sit on the settings page's slider steps (spacing 0.05,
  radius 0.125, width 1) and inside the bounds
  `validate_and_apply_hub_payload` enforces on hub configurations.
- Font stacks must be **copied verbatim** from field 7 of the matching
  `font|<slot>|<id>|…` row in `font-presets.conf`. The device reverse-maps the
  stack back to a roster id to know which woff2 files to fetch; a retyped
  stack matches nothing and the preset silently renders its fallback family.

A brand-new preset also needs:

- a new `root/usr/share/aurora/<name>.template` file in this repo (copy an
  existing one — `gen-presets.mjs` only rewrites templates that already
  exist, it never creates one)
- `gallery.js` → `BUILTIN_PRESETS` (store card) and `BUILTIN_SEED_RE` (so the
  hub's own seed of it is not listed twice)
- `luci.aurora` → `resolve_preset_path()` (name → template path)
- `80_aurora` → template fallback chain (optional)
- `tests/builtin-presets.test.mjs` → `PRESET_IDS`

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

Minification is off for this package (§11), so what ships is exactly what
`node --check` above validated.

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
| `apply_theme_preset` | Apply a built-in preset: colours **plus** navigation, spacing, radius, content width, both font stacks and the toolbar switch. Shortcut sections and brand images are left untouched |
| `export_config` / `import_config` | Configuration import/export |
| `list_icons` / `upload_icon` / `remove_icon` | Icon management |
| `prepare_font` / `get_font_presets` / `get_font_status` | Font handling |
| `upload_font` / `remove_font` | Custom (user-uploaded) font management |
| `hub_list` / `hub_get` | Theme Store: browse the hub's config list / read one config's full payload |
| `hub_apply` / `get_hub_status` | Theme Store: kick off an async apply job / poll its progress |
| `hub_restore_backup` | Theme Store: one-tap rollback to the pre-apply snapshot |
| `hub_share` / `hub_update` / `hub_delete` | Theme Store: publish the current config / edit / unpublish a share |
| `hub_my_shares` | Theme Store: list this device's own published shares |

ACLs live in `root/usr/share/rpcd/acl.d/luci-app-aurora.json`; the menu entries
(`Theme Settings`, `Theme Store`) in
`root/usr/share/luci/menu.d/luci-app-aurora.json`. §8 below covers the Theme
Store in detail.

> `load_preset_snapshot()` validates that a template's `option (light|dark)_`
> line count equals `COLOR_TOKEN_KEYS count × 2`. The key list ships as
> `/usr/share/aurora/color-tokens.conf`, generated by `sync-tokens.mjs` from
> the same registry as the templates, so the two cannot drift apart. It then
> calls `load_preset_struct_snapshot()`, which requires **every**
> `PRESET_STRUCT_KEYS` option and checks each against the same bounds
> `validate_and_apply_hub_payload` applies to a hub configuration — a preset
> and a shared config are the same kind of thing, so one must not be able to
> write a value the other rejects. A template missing any of them fails the
> whole apply rather than landing half a look on top of the previous one.

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

## 8. Theme Store

The Theme Store lets users browse configurations shared by other users, apply
one with a single click, and share their own — all through a public hub at
**`https://themes.eamonxg.fun`**. Nothing about it changes how colors are
derived or how UCI is structured; it is a distribution layer on top of the
existing config format.

### 8.1 Pieces

- **`view/aurora/gallery.js`** — the `admin/system/aurora/gallery` page: a
  card grid (Hot/New sort, swatch preview, downloads count) that opens a
  detail modal per config (palette, layout, typography, included assets) with
  an Apply button; a "Share My Configuration" modal; and a "My Shares" table
  (update-with-current-config / delete) shown only when the device has
  published at least one share. All hub-sourced text (name, author, hex
  values, toolbar URLs) is rendered via `E()`'s safe children or
  `document.createTextNode` — never `innerHTML` — since it is untrusted
  server content.
- **`utils/hub-api.js`** — `rpc.declare` wrappers for every `hub_*` method
  against the `luci.aurora` object, plus a 5-minute `localStorage` cache
  (`aurora.hub.list`) for the "hot" list so the page can paint instantly from
  a stale copy while it revalidates.
- **`root/usr/libexec/rpcd/luci.aurora`** — the backend: talks to the hub over
  HTTP, validates everything it gets back, and applies it to UCI.

### 8.2 rpcd methods (object `luci.aurora`)

| Method | Purpose |
| --- | --- |
| `hub_list(sort, page)` | Fetch a page of the hub's config list (`sort` is `hot` or `new`) |
| `hub_get(id)` | Fetch one config's full payload + asset list for the detail modal |
| `hub_apply(id)` | Forks an async apply job (`hub_apply_worker`) in the background, returns a `job_id` immediately |
| `get_hub_status(job_id)` | Poll a job's `state`/`step`/`error`; the frontend polls this every 1.5s (`gallery.js: pollApplyStatus`) |
| `hub_restore_backup` | Roll back to the single most recent pre-apply snapshot |
| `hub_share(name, description, author)` | Publish the current local config as a new hub entry |
| `hub_my_shares` | List this device's own published shares (re-validates each id against the hub, dropping any that 404) |
| `hub_update(id, name, author, description)` | Republish this device's share `id` with the current local config |
| `hub_delete(id)` | Unpublish share `id` |

### 8.3 Device identity

Every hub write (`hub_share`/`hub_update`/`hub_delete`) and the download-count
ping after an apply are authenticated by a per-device identity, created
lazily by `ensure_device_identity()` on first use:

- **`/etc/aurora/device.key`** (mode `0600`) — 32 random bytes, hex-encoded,
  as `device_token`. This is a secret: it is the only thing that lets the hub
  accept an update/delete against a device's own shares. It is never rendered
  in any UI and never leaves the router except as the `device_token` field of
  a `hub_share`/`hub_update`/`hub_delete` POST/PUT/DELETE body.
- **`/etc/aurora/device.hash`** (mode `0644`) — a second, independent random
  hex value, `device_hash`, sent only with the download-count ping. It
  carries no authority (there is nothing it can authenticate) and exists
  purely for anonymous download deduplication on the hub side.
- Both files are listed in `/etc/sysupgrade.conf.d/aurora-device`, so a
  `sysupgrade` that preserves configuration keeps the same device identity
  (and thus the same ownership over previously published shares) across
  firmware upgrades.

### 8.4 Apply flow (`hub_apply` → `hub_apply_worker`)

`hub_apply` validates the id, forks `hub_apply_worker` in the background, and
returns a `job_id` right away; the worker writes each step to a status file
under `/tmp/aurora_hub_jobs/<job_id>.status` for `get_hub_status` to read:

1. **backup** — copies the current `/etc/config/aurora` to
   `/etc/aurora/pre-hub-backup.conf` (single slot: only the most recent apply
   can be rolled back).
2. **fetch** — `GET`s the full config payload from the hub.
3. **validate** — `validate_and_apply_hub_payload()` treats the hub as
   untrusted input and re-checks every field with the *same* rules the
   frontend/local share path enforces (exact 62 `light_*`/`dark_*` hex keys,
   enum-checked `nav_type`/font ids, bounded/regex-checked rem values and
   font stacks, per-item toolbar validation, `has_control_char` guards
   against embedded-newline UCI injection) using only `case`/`grep -E` — no
   `eval`. Nothing is written to UCI until every field passes; a single `uci
   batch` (colors deleted then reset, layout/typography set, `toolbar_item`
   sections replaced, `hub_applied` + `icon_cache_version` bookkeeping) is
   then committed atomically, and reverted if the commit fails.
4. **assets** — any image assets in the payload are fetched from the hub and
   sha256-verified (`fetch_verified`) before being written under
   `/www/luci-static/aurora/images/`; a login-background asset also updates
   `struct_login_bg`. Best-effort: a failed asset fetch doesn't fail the job.
5. **finalize** — resyncs font CSS, bumps the icon cache timestamp, marks the
   job `done`.
6. **download count** — fires a fire-and-forget `POST .../download` with
   `device_hash` after the job completes, for the hub's download counter.

If validation or fetch fails, the job is marked `error` with a step and error
code; the frontend maps every code to a result-only message (never surfaces
words like `bad_payload` or `job`) and never leaves partial state — either the
whole batch commits or none of it does.

**Rollback**: `hub_restore_backup` copies `pre-hub-backup.conf` back over
`/etc/config/aurora`, resyncs font CSS and the icon cache timestamp, and
returns `no_backup` if nothing has been applied yet in this backup slot. The
gallery page shows a persistent banner ("Applied `<name>`" + "Restore
previous configuration") whenever `aurora.theme.hub_applied` is set, so
rollback is always one tap away, not just immediately after applying.

### 8.5 Share v1 scope

`build_share_payload()` assembles the current `/etc/config/aurora` into the
hub's schema (colors, layout, typography, toolbar, assets) and is shared by
both `hub_share` and `hub_update`. Deliberate v1 limits:

- **Images only, no custom fonts.** Only the six image asset kinds
  (`logo_svg`, `favicon_png`, `favicon_ico`, `pwa_icon_192`, `pwa_icon_512`,
  `login_bg`) are ever uploaded; `typography.font_sans`/`font_mono` are
  shared as **preset ids** only (`resolve_font_preset_id`), never as uploaded
  `.woff2` bytes — a custom font a user uploaded locally is never re-uploaded
  to the public hub.
- **Skips factory-default images.** An image asset is only included if its
  UCI value differs from the package's stock filename (`logo.svg`,
  `favicon.ico`, `app-icon-192x192.png`, `app-icon-512x512.png`,
  `apple-touch-icon.png`) — an unmodified slot means the user never
  customized it, so there's nothing worth uploading and nothing
  copyright-risky to check. Each included asset is also read back from disk,
  sha256'd, and size-checked before upload, and any filename containing `/`
  or `..` is rejected outright (defense against path traversal into
  `$ICON_PATH`).
- Toolbar entries are re-validated with the hub's exact per-field limits
  (title 1-30 chars, url ≤200 chars + scheme, icon charset+≤64 chars, ≤12
  entries) at share time — an out-of-range item is silently dropped from the
  share rather than rejecting the whole publish.

---

## 9. Releasing

OpenWrt package metadata lives in the `Makefile`:

```
PKG_VERSION  # semantic version; bump at least a patch for breaking schema changes
PKG_RELEASE  # YYYYMMDD-style date
```

CI builds `.ipk` / `.apk` artifacts through the `build-luci-package` Action using
the OpenWrt SDK.

---

## 10. Troubleshooting cheat sheet

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
- **A page dies with `Invalid regular expression: missing /`, but `node --check`
  passes on the source?** The packaged copy was mangled by jsmin — see §11.
  Confirm by diffing the device's file size against the repo's.

---

## 11. Packaging pitfall: jsmin vs. ES6

`luci.mk` minifies every `.js` with Crockford's **jsmin** whenever
`LUCI_MINIFY_JS` is 1 — and `luci.mk` defaults it to 1. jsmin is from the
1990s and predates every ES6 construct this package uses, so it does not
merely fail to shrink things: **it rewrites them into something else.**

This package therefore sets `LUCI_MINIFY_JS:=0` in its `Makefile`, before the
`luci.mk` include (the variable is declared with `?=`, so it must be set
first). Everything below is why.

### What it gets wrong

**1. A regex literal after an arrow becomes a division.** jsmin decides a `/`
opens a regex only when the previous non-blank character is one of:

```
( , = : [ ! & | ? { } ; \n
```

An arrow's `>` is not in that set. So in `(url) => /^https?:\/\//.test(url)`
the `/` reads as division, and the two adjacent slashes inside the regex then
look like a line comment — **everything from there to the end of the line is
deleted**. The regex loses its terminator and the browser reports
`Invalid regular expression: missing /`. The whole view fails to load.

This actually shipped: the theme store was dead on-device for exactly this
reason, in `gallery.js`'s `isExternalShortcut`.

**2. Template literals are not understood at all.** Backticks mean nothing to
jsmin, so:

- the `//` in `` `https://${FEED_HOST}/manifest.json` `` is eaten as a line
  comment, same as above;
- whitespace *inside* the literal is stripped as if it were code. Multi-line
  inline CSS is the dangerous case: a descendant selector `.a .b` is squeezed
  to `.a.b`, which silently means "an element with both classes". **No syntax
  error, no console message — the styling just quietly stops matching.**

### Reproducing it

```bash
npm install jsmin --no-save
for f in $(find htdocs/luci-static/resources -name '*.js'); do
  ./node_modules/.bin/jsmin "$f" > /tmp/m.js
  node --check /tmp/m.js || echo "MANGLED: $f"
done
```

Note this only catches breakage #1 (a syntax error). Breakage #2 produces
*valid* JS with different behaviour, so it will pass this check — that
asymmetry is the main reason minification is off rather than worked around.

### The rule that survives anyway

Never write a regex literal directly after an arrow. Bind it to a constant
first, so the preceding character is `=`:

```js
const EXTERNAL_URL_RE = /^https?:\/\//;
const isExternalShortcut = (url) => EXTERNAL_URL_RE.test(shortcutText(url));
```

`tests/jsmin-safety.test.mjs` enforces this across every non-vendored file. It
is kept as a second line of defence: if minification is ever switched back on,
or this source is vendored into a tree that minifies, the most damaging of the
two failure modes is already designed out. `*.global.js` is exempt — the
vendored color library and the generated tokens bundle are not ours to edit,
and the regexes they put after arrows contain no adjacent slashes.

**Sibling packages:** `luci-theme-aurora` and `luci-theme-shadcn` do not
override `LUCI_MINIFY_JS`. Their Vite output survives jsmin's syntax check,
but breakage #2 is invisible to that check — worth a look if styling ever
misbehaves only on-device.
