#!/bin/sh
# Rebuilds assets/icon.icns from assets/icon.svg.
# Uses only tools that ship with macOS (sips, iconutil).
set -e
cd "$(dirname "$0")/.."

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
set_dir="$tmp/icon.iconset"
mkdir "$set_dir"

sips -s format png assets/icon.svg --out "$tmp/1024.png" >/dev/null

for size in 16 32 128 256 512; do
  double=$((size * 2))
  sips -z "$size" "$size" "$tmp/1024.png" --out "$set_dir/icon_${size}x${size}.png" >/dev/null
  sips -z "$double" "$double" "$tmp/1024.png" --out "$set_dir/icon_${size}x${size}@2x.png" >/dev/null
done

iconutil -c icns "$set_dir" -o assets/icon.icns
echo "Wrote assets/icon.icns"
