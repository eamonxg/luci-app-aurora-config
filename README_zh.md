<h4 align="right"><a href="README.md"><strong>English</strong></a> | 简体中文</h4>
<h1 align="center">LuCI App Aurora Config</h1>
<p align="center"><strong>Aurora 主题的个性化助手。</strong></p>
<h4 align="center">🎨 视觉定制 | 📐 界面布局 | 🚀 一键更新</h4>
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

## 功能特性

- **专业配色系统**：内置 5 种主题预设（Classic、Monochrome、Sage Green、Amber Sand、Sky Blue），并提供直观的配色编辑，轻松调整整体风格。
- **布局与间距控制**：调整导航子菜单样式和全局元素间距，完美适配您的屏幕显示。
- **品牌标识**：自定义主题 Logo（favicon）并配置常用页面的悬浮工具栏快捷方式。
- **无缝更新**：直接在界面中更新主题和配置应用，无需使用 CLI 命令行或 SSH。

<div align="center">
  <img src="https://raw.githubusercontent.com/eamonxg/assets/master/aurora/preview/config/multi-theme-showcase.png" alt="Multi Theme Showcase" width="1200">
</div>

## 兼容性

| 组件                  | 要求        | 说明                     |
| :-------------------- | :---------- | :----------------------- |
| **LuCI Theme Aurora** | `≥ v0.10.0` | 旧版本将忽略这些配置。   |
| **OpenWrt**           | `≥ 23.05`   | 不支持基于 Lua 的 LuCI。 |

## 安装

### 使用 opkg:

```sh
cd /tmp
wget -O luci-app-aurora-config.ipk https://github.com/eamonxg/luci-app-aurora-config/releases/latest/download/luci-app-aurora-config_0.2.0-r20260119_all.ipk
opkg install luci-app-aurora-config.ipk
```

### 使用 apk:

```sh
cd /tmp
wget -O luci-app-aurora-config.apk https://github.com/eamonxg/luci-app-aurora-config/releases/latest/download/luci-app-aurora-config-0.2.0-r20260119.apk
apk add --allow-untrusted luci-app-aurora-config.apk
```
