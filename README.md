<h4 align="right"><strong>English</strong> | <a href="README_zh.md">简体中文</a></h4>
<h1 align="center">LuCI App Aurora Config</h1>
<p align="center"><strong>The personalized assistant for the Aurora Theme.</strong></p>
<h4 align="center">🎨 Visual Customization | 📐 Interface Layout | 🚀 One-Click Updates</h4>
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

- **Professional Color System**: Built-in theme presets (Classic, Monochrome, Sage Green, Amber Sand, Sky Blue) and an easy color editor to tune the look and feel.
- **Layout & Density Control**: Adjust navigation submenu styles and global element spacing to fit your screen perfectly.
- **Brand Identity**: Customize the theme logo (favicon) and configure floating toolbar shortcuts for frequently used pages.
- **Seamless Updates**: Update the theme and config app directly from the interface—no CLI or SSH required.

<div align="center">
  <img src="https://raw.githubusercontent.com/eamonxg/assets/master/aurora/preview/config/multi-theme-showcase.png" alt="Multi Theme Showcase" width="1200">
</div>

## Compatibility

| Component             | Requirement | Note                                             |
| :-------------------- | :---------- | :----------------------------------------------- |
| **LuCI Theme Aurora** | `≥ v0.10.0` | Older versions will ignore these configurations. |
| **OpenWrt**           | `≥ 23.05`   | Lua-based LuCI are not supported.                |

## Installation

### Using opkg:

```sh
cd /tmp && wget -O luci-app-aurora-config.ipk https://github.com/eamonxg/luci-app-aurora-config/releases/latest/download/luci-app-aurora-config_0.2.0-r20260119_all.ipk && opkg install luci-app-aurora-config.ipk
```

### Using apk:

```sh
cd /tmp && wget -O luci-app-aurora-config.apk https://github.com/eamonxg/luci-app-aurora-config/releases/latest/download/luci-app-aurora-config-0.2.0-r20260119.apk && apk add --allow-untrusted luci-app-aurora-config.apk
```
