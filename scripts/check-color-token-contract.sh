#!/bin/sh

set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
THEME_JS="$ROOT/htdocs/luci-static/resources/view/aurora/theme.js"

expected="$(mktemp)"
actual="$(mktemp)"
missing="$(mktemp)"
extra="$(mktemp)"
trap 'rm -f "$expected" "$actual" "$missing" "$extra"' EXIT HUP INT TERM

cat >"$expected" <<'EOF'
brand
brand_emphasis
brand_faint
brand_hover
brand_soft
button_muted_bg
button_muted_border
button_muted_content
button_muted_hover_bg
button_secondary_bg
button_secondary_border
button_secondary_content
button_secondary_hover_bg
canvas
card_action_bg
content
content_muted
content_subtle
danger
danger_border
danger_content
danger_surface
focus_ring
glass_raised
glass_surface
header_bg
header_glass_bg
header_interactive_bg
ifacebox_header_bg
info
info_border
info_content
info_surface
input_bg
input_checked_content
interface_badge_bg
link
neutral_status_border
neutral_status_content
neutral_status_surface
on_brand
progress_end
progress_start
progress_track_bg
scrim
segmented_control_bg
success
success_border
success_content
success_surface
surface
surface_muted
surface_raised
surface_subtle
table_header_bg
table_row_alternate_bg
table_row_hover_bg
terminal_bg
terminal_content
tooltip_bg
warning
warning_border
warning_content
warning_surface
border_faint
border_strong
border_subtle
EOF

sort -u "$expected" -o "$expected"
failed=0

check_key_set() {
  label="$1"
  file="$2"

  sort "$file" | uniq >"$actual"
  comm -23 "$expected" "$actual" >"$missing"
  comm -13 "$expected" "$actual" >"$extra"

  if [ -s "$missing" ]; then
    printf '%s missing keys:\n' "$label" >&2
    sed 's/^/  /' "$missing" >&2
    failed=1
  fi

  if [ -s "$extra" ]; then
    printf '%s unexpected keys:\n' "$label" >&2
    sed 's/^/  /' "$extra" >&2
    failed=1
  fi

  duplicates="$(
    sort "$file" | uniq -d
  )"
  if [ -n "$duplicates" ]; then
    printf '%s duplicate keys:\n%s\n' "$label" "$duplicates" >&2
    failed=1
  fi
}

for preset in classic sage-green amber-sand monochrome sky-blue; do
  template="$ROOT/root/usr/share/aurora/$preset.template"
  color_count="$(
    awk '$1 == "option" && $2 ~ /^(light|dark)_/ { count++ } END { print count + 0 }' "$template"
  )"

  if [ "$color_count" -ne 134 ]; then
    printf '%s: expected 134 color options, found %s\n' "$template" "$color_count" >&2
    failed=1
  fi

  for mode in light dark; do
    keys="$(mktemp)"
    awk -v prefix="${mode}_" \
      '$1 == "option" && index($2, prefix) == 1 { print substr($2, length(prefix) + 1) }' \
      "$template" >"$keys"
    check_key_set "$preset $mode" "$keys"
    rm -f "$keys"
  done

  unsafe="$(
    awk '$1 == "option" && $2 ~ /^(light|dark)_/ && $0 ~ /[;{}<>]/ { print NR ":" $0 }' "$template"
  )"
  if [ -n "$unsafe" ]; then
    printf '%s contains unsafe color values:\n%s\n' "$template" "$unsafe" >&2
    failed=1
  fi
done

js_keys="$(mktemp)"
awk '/^const COLOR_TOKENS = \[/,/^\];/' "$THEME_JS" \
  | sed -n 's/^[[:space:]]*key: "\([a-z0-9_]*\)",[[:space:]]*$/\1/p' >"$js_keys"
check_key_set "theme.js COLOR_TOKENS" "$js_keys"
rm -f "$js_keys"

old_lqip="$(
  rg -n 'light_login_bg_lqip' "$ROOT/htdocs" "$ROOT/root" || true
)"
if [ -n "$old_lqip" ]; then
  printf '%s\n%s\n' "Legacy light_login_bg_lqip references remain:" "$old_lqip" >&2
  failed=1
fi

if ! rg -q 'struct_login_bg_lqip' "$THEME_JS"; then
  printf '%s\n' "theme.js does not define struct_login_bg_lqip" >&2
  failed=1
fi

if [ "$failed" -ne 0 ]; then
  exit 1
fi

printf 'Aurora config color contract passed: five complete presets and 67 UI token definitions.\n'
