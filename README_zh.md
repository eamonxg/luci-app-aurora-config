<h4 align="right"><a href="README.md"><strong>English</strong></a> | 简体中文</h4>
<h1 align="center">LuCI App Aurora Config</h1>
<p align="center">LuCI Theme Aurora 的配置中心——配色、布局、字体、品牌与主题商店。</p>
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

- **内置预设**——5 套完整外观，导航形态、圆角、间距、内容宽度与字体各不相同，不只是换个配色。
- **配色系统**——浅色/深色独立的实时配色编辑器，派生色自动生成。
- **布局**——Mega Menu、下拉、侧边栏三种导航；滑块微调间距比例、圆角与内容宽度。
- **排版与字体**——精选网络字体，保存后才从固定版本、经校验的来源下载一次；也可上传自己的 `.woff2` 字体。
- **品牌与 PWA**——拖拽上传的资源库（上传时可重命名），统一供给 Logo、favicon、应用图标与登录背景；自动生成 manifest，面板可作为 PWA 安装。
- **悬浮工具栏**——添加、命名并拖拽排序快捷方式，快速访问常用页面。
- **备份与恢复**——一键导出、导入或重置整套配置，无需 SSH。
- **主题商店**——浏览、应用、分享主题配置。

<div align="center">
  <img src="https://raw.githubusercontent.com/eamonxg/assets/master/aurora/preview/config/multi-theme-showcase.png" alt="Multi Theme Showcase" width="1200">
</div>

## 兼容性

| 组件                  | 要求        | 说明                     |
| :-------------------- | :---------- | :----------------------- |
| **LuCI Theme Aurora** | `≥ v1.1.0`  | 旧版本将忽略这些配置。   |
| **OpenWrt**           | `≥ 23.05`   | 不支持基于 Lua 的 LuCI。 |

## 安装

以下命令均在路由器本机执行（例如通过 SSH 会话）。

### 使用 eamonxg 软件源:

```sh
wget -qO- https://openwrt.eamonxg.fun/install.sh | sh
```

这就是全部安装步骤——脚本会添加软件源，并安装您从列表中勾选的软件包，翻译一并装好。之后用常规命令升级即可：`apk update && apk upgrade luci-app-aurora-config`，或 `opkg update && opkg upgrade luci-app-aurora-config`。详细信息见 [openwrt.eamonxg.fun](https://openwrt.eamonxg.fun/)。

> **apk**：若此前是从下载的 `.apk` 文件安装的，该文件会把软件包钉死在 `/etc/apk/world` 里，此后 `apk upgrade` 会静默地什么都不做——报告成功，版本却没变。执行一次 `apk add luci-app-aurora-config`（只写包名，不带路径）即可解除。上面的脚本已自动处理这一步。

### 使用 GitHub Release:

OpenWrt 25.12+ 和 Snapshot 版本使用 `apk`；其他版本使用 `opkg`：

> **提示**：您可以运行 `opkg --version` 或 `apk --version` 来确认您的包管理器。如果有输出内容（而非 "not found"），那就是您的包管理器。

```sh
cd /tmp

# opkg
uclient-fetch -O luci-app-aurora-config.ipk https://github.com/eamonxg/luci-app-aurora-config/releases/latest/download/luci-app-aurora-config_1.1.0-r20260711_all.ipk
opkg install luci-app-aurora-config.ipk

# apk
uclient-fetch -O luci-app-aurora-config.apk https://github.com/eamonxg/luci-app-aurora-config/releases/latest/download/luci-app-aurora-config-1.1.0-r20260711.apk
apk add --allow-untrusted luci-app-aurora-config.apk
```

## 从源码构建

使用 OpenWrt 构建系统自行编译。主机前置条件见 [Build system setup](https://openwrt.org/docs/guide-developer/toolchain/install-buildsystem)。产物位于 `bin/packages/<arch>/base/`（例如 `bin/packages/x86_64/base/luci-app-aurora-config_*_all.ipk`），拷贝到路由器后按上文方式安装即可。

### 通过完整源码或 SDK

准备环境——克隆完整源码：

```sh
# 完整源码——openwrt-24.10 分支构建 .ipk，main 分支构建 .apk
git clone https://github.com/openwrt/openwrt.git
cd openwrt
git checkout openwrt-24.10
```

或 [预编译 SDK](https://openwrt.org/docs/guide-developer/toolchain/using_the_sdk)（更快，省去编译工具链）。从 [downloads.openwrt.org](https://downloads.openwrt.org) 下载与目标匹配的压缩包，下载页面按 Release 和 Snapshot 分类——Release 24.10.x 及以下构建 `.ipk`；Release 25.12+ 和 Snapshot 构建 `.apk`（文件名、架构、压缩格式因目标而异）：

```sh
wget <从 downloads.openwrt.org 获取的 SDK 压缩包地址>
tar -xf openwrt-sdk-*.tar.*
cd openwrt-sdk-*/
```

然后在该目录下：

```sh
# 加入本软件包并安装 feeds（提供 luci-base）
git clone https://github.com/eamonxg/luci-app-aurora-config.git package/luci-app-aurora-config
./scripts/feeds update -a
./scripts/feeds install -a

# 在 menuconfig 中勾选应用：LuCI → Applications → luci-app-aurora-config
make menuconfig

# 用 SDK 时跳过这两行——它已自带编译好的工具链
make tools/install -j$(nproc)
make toolchain/install -j$(nproc)

make package/luci-app-aurora-config/compile -j$(nproc) V=s
```
