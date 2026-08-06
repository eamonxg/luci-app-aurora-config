# See /LICENSE for more information.
# This is free software, licensed under the GNU General Public License v2.

include $(TOPDIR)/rules.mk

LUCI_TITLE:=LuCI configuration UI for the Aurora theme
LUCI_DEPENDS:=+luci-base
LUCI_PKGARCH:=all

PKG_VERSION:=1.1.14
PKG_RELEASE:=20260806
PKG_LICENSE:=Apache-2.0

# jsmin (luci.mk's default JS minifier) predates ES6 and corrupts this
# package's sources -- regexes after arrows, template literals, inline CSS
# whitespace. Full story and repro: docs/DEVELOPMENT.md §11.
LUCI_MINIFY_JS:=0

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
