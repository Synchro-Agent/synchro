#!/usr/bin/env bash
# Tải lại phông tĩnh cho poster dựng ở máy chủ (app/design-engine/posters, Satori qua next/og): Satori chỉ đọc TTF / OTF / WOFF tĩnh, không đọc WOFF2
# hay phông biến thiên (bản ghim trong workspace/Dockerfile là [wght], Satori chỉ lấy độ đậm mặc định). Google Fonts sinh bản tĩnh đủ bộ chữ (có tiếng Việt)
# khi trình duyệt không nhận WOFF2. Mã băm ghim đúng từng byte: tệp đổi thì lệnh dừng, không lặng lẽ thay phông. Giấy phép SIL OFL 1.1 (OFL.txt cạnh tệp).
set -euo pipefail
cd "$(dirname "$0")/../app/design-engine/fonts"
base=https://fonts.gstatic.com/s/plusjakartasans/v12
while read -r sum id name; do
  curl -fsSL -o "$name" "$base/$id.ttf"
  printf '%s  %s\n' "$sum" "$name" | shasum -a 256 -c -
done <<'LIST'
076831b98043f50f829b6c91db3be4a844641f1c95bccff5c886ed87c661a852 LDIbaomQNQcsA88c7O9yZ4KMCoOg4IA6-91aHEjcWuA_qU7NSg PlusJakartaSans-Regular.ttf
32971ad7976930539a11c79ce91ce84092df7f25c5be716b594601842f10a7ae LDIbaomQNQcsA88c7O9yZ4KMCoOg4IA6-91aHEjcWuA_TknNSg PlusJakartaSans-Bold.ttf
d9e0ddb4a15a0054ad84b4ded3b4b9f354a0b7df426e21a1363d6933728da9d5 LDIbaomQNQcsA88c7O9yZ4KMCoOg4IA6-91aHEjcWuA_KUnNSg PlusJakartaSans-ExtraBold.ttf
LIST
