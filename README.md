<h4 align="right"><strong>English</strong> | <a href="README_zh.md">简体中文</a></h4>
<h1 align="center">LuCI App Aurora Config</h1>
<p align="center">The configuration hub for LuCI Theme Aurora — colors, layout, typography, branding, and updates.</p>
<div align="center">
  <a href="https://openwrt.org"><img alt="OpenWrt" src="https://img.shields.io/badge/OpenWrt-%E2%89%A523.05-00B5E2?logo=openwrt&logoColor=white"></a>
  <a href="https://github.com/eamonxg/luci-theme-aurora"><img alt="LuCI Theme Aurora" src="https://img.shields.io/badge/Theme-Aurora-46a3d1?logo=openwrt&logoColor=white"></a>
  <a href="https://github.com/eamonxg/luci-app-aurora-config/releases/latest"><img alt="GitHub Release" src="https://img.shields.io/github/v/release/eamonxg/luci-app-aurora-config?logo=github&color=4ADE80"></a>
  <a href="https://github.com/eamonxg/luci-app-aurora-config/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/eamonxg/luci-app-aurora-config/total?color=orange"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache%202.0-blue?logo=apache"></a>
</div>

<div align="center">
  <img src="https://raw.githubusercontent.com/eamonxg/assets/master/aurora/preview/config/theme-settings-showcase.png" alt="Theme Settings Showcase" width="100%">
</div>

## Features

- **Color system** — five built-in presets plus a live editor with independent light and dark palettes; derived tones are computed automatically.
- **Layout** — Mega Menu, Dropdown, or Sidebar navigation; sliders for spacing scale, corner radius, and content width.
- **Typography** — curated webfonts, downloaded once on save from pinned, checksum-verified sources — or upload your own `.woff2` files.
- **Branding & PWA** — a drag-and-drop asset library (files can be renamed on upload) feeding the logo, favicons, app icons, and login background; a generated manifest makes the panel installable as a PWA.
- **Shortcut toolbar** — add, label, and drag-reorder entries in the floating launcher.
- **Backup & updates** — export, import, or reset the whole configuration and update the theme and app from the interface, no SSH required.

<div align="center">
  <img src="https://raw.githubusercontent.com/eamonxg/assets/master/aurora/preview/config/multi-theme-showcase.png" alt="Multi Theme Showcase" width="1200">
</div>

## Compatibility

| Component             | Requirement | Note                                             |
| :-------------------- | :---------- | :----------------------------------------------- |
| **LuCI Theme Aurora** | `≥ v1.1.0`  | Older versions will ignore these configurations. |
| **OpenWrt**           | `≥ 23.05`   | Lua-based LuCI is not supported.                 |

## Installation

Run these commands on the router itself (e.g. over an SSH session).

### Using the eamonxg feed:

OpenWrt 25.12+ and snapshots use `apk`; other versions use `opkg`:

> **Tip**: You can confirm your package manager by running `opkg --version` or `apk --version`. If it returns output (not "not found"), that's your package manager.

```sh
wget -qO- https://openwrt.eamonxg.fun/install.sh | sh
```

- **opkg** (OpenWrt < 25.12):

  ```sh
  opkg install luci-app-aurora-config
  ```

- **apk** (OpenWrt 25.12+ and snapshots):

  ```sh
  apk add luci-app-aurora-config
  ```

Adds the feed once; later updates are just `opkg update && opkg install luci-app-aurora-config` / `apk update && apk add luci-app-aurora-config` — no re-downloading the file. Details: [openwrt.eamonxg.fun](https://openwrt.eamonxg.fun/).

### Using a GitHub release:

```sh
cd /tmp

# opkg
uclient-fetch -O luci-app-aurora-config.ipk https://github.com/eamonxg/luci-app-aurora-config/releases/latest/download/luci-app-aurora-config_1.1.0-r20260711_all.ipk
opkg install luci-app-aurora-config.ipk

# apk
uclient-fetch -O luci-app-aurora-config.apk https://github.com/eamonxg/luci-app-aurora-config/releases/latest/download/luci-app-aurora-config-1.1.0-r20260711.apk
apk add --allow-untrusted luci-app-aurora-config.apk
```

## Build from source

Build the package yourself with the OpenWrt build system. Host prerequisites: [Build system setup](https://openwrt.org/docs/guide-developer/toolchain/install-buildsystem). The build writes the package to `bin/packages/<arch>/base/` (e.g. `bin/packages/x86_64/base/luci-app-aurora-config_*_all.ipk`); copy it to your router and install it as above.

### Via the full source tree or SDK

Get set up — clone the full source tree:

```sh
# Full source tree — the openwrt-24.10 branch builds an .ipk, the main branch builds an .apk
git clone https://github.com/openwrt/openwrt.git
cd openwrt
git checkout openwrt-24.10
```

Or the [prebuilt SDK](https://openwrt.org/docs/guide-developer/toolchain/using_the_sdk) (faster: skips building the toolchain). Grab the archive for your target from [downloads.openwrt.org](https://downloads.openwrt.org), which splits SDKs into Release and Snapshot builds — Release 24.10.x and earlier build `.ipk`; Release 25.12+ and Snapshot build `.apk` (filename, arch and compression vary by target):

```sh
wget <sdk-archive-url-from-downloads.openwrt.org>
tar -xf openwrt-sdk-*.tar.*
cd openwrt-sdk-*/
```

Then, from that directory:

```sh
# Add this package and install feeds (provides luci-base)
git clone https://github.com/eamonxg/luci-app-aurora-config.git package/luci-app-aurora-config
./scripts/feeds update -a
./scripts/feeds install -a

# Select the app in menuconfig: LuCI → Applications → luci-app-aurora-config
make menuconfig

# Skip these two lines with the SDK — it already ships a built toolchain
make tools/install -j$(nproc)
make toolchain/install -j$(nproc)

make package/luci-app-aurora-config/compile -j$(nproc) V=s
```
