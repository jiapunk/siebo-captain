#!/usr/bin/env bash
# 由範本 scripts/com.siebo.evomap.heartbeat.plist 產生 EvoMap 心跳的 launchd plist。
#
#   scripts/evomap-heartbeat-install.sh             # 產生到 ~/Library/LaunchAgents/com.siebo.evomap.heartbeat.plist（不載入）
#   scripts/evomap-heartbeat-install.sh --out PATH  # 產生到指定路徑（先檢查內容用）
#   scripts/evomap-heartbeat-install.sh --load      # 產生後用 launchctl 重新載入（會先 bootout 同名的舊排程）
#
# 可用環境變數覆寫：
#   NODE_BIN             node 絕對路徑（預設 command -v node）
#   EVOMAP_HEARTBEAT_LOG log 檔（預設 ~/Library/Logs/siebo-evomap-heartbeat.log）
#
# 心跳過了 .env 的 EVOMAP_HEARTBEAT_UNTIL 就不再連線；排程本身要自己移除：
#   launchctl unload ~/Library/LaunchAgents/com.siebo.evomap.heartbeat.plist
set -euo pipefail

LABEL="com.siebo.evomap.heartbeat"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd -P)"
TEMPLATE="$SCRIPT_DIR/$LABEL.plist"
OUT="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_PATH="${EVOMAP_HEARTBEAT_LOG:-$HOME/Library/Logs/siebo-evomap-heartbeat.log}"
LOAD=0

usage() { sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="${2:?--out 需要路徑}"; shift 2 ;;
    --out=*) OUT="${1#--out=}"; shift ;;
    --load) LOAD=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知參數：$1" >&2; usage >&2; exit 2 ;;
  esac
done

NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "找不到可執行的 node（可用 NODE_BIN=/絕對路徑/node 指定）" >&2
  exit 1
fi
case "$NODE_BIN" in /*) ;; *) echo "NODE_BIN 必須是絕對路徑：$NODE_BIN" >&2; exit 1 ;; esac
case "$LOG_PATH" in /*) ;; *) echo "log 路徑必須是絕對路徑：$LOG_PATH" >&2; exit 1 ;; esac
if [ ! -f "$PROJECT_DIR/node_modules/tsx/dist/cli.mjs" ]; then
  echo "找不到 $PROJECT_DIR/node_modules/tsx/dist/cli.mjs —— 先在專案根目錄執行 npm i" >&2
  exit 1
fi
[ -f "$TEMPLATE" ] || { echo "找不到範本 $TEMPLATE" >&2; exit 1; }

# 值先做 XML 跳脫，再做 sed 取代字串跳脫（分隔符用 |）
xml_escape() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
sed_escape() { printf '%s' "$1" | sed -e 's/[\\|&]/\\&/g'; }
NODE_V="$(sed_escape "$(xml_escape "$NODE_BIN")")"
PROJ_V="$(sed_escape "$(xml_escape "$PROJECT_DIR")")"
LOG_V="$(sed_escape "$(xml_escape "$LOG_PATH")")"

mkdir -p "$(dirname "$OUT")" "$(dirname "$LOG_PATH")"
TMP="$(mktemp "${TMPDIR:-/tmp}/$LABEL.XXXXXX")"
trap 'rm -f "$TMP"' EXIT
sed -e "s|__NODE_BIN__|$NODE_V|g" \
    -e "s|__PROJECT_DIR__|$PROJ_V|g" \
    -e "s|__LOG_PATH__|$LOG_V|g" \
    "$TEMPLATE" > "$TMP"

if grep -q '__[A-Z_]*__' "$TMP"; then
  echo "範本還有未替換的佔位符：" >&2
  grep -n '__[A-Z_]*__' "$TMP" >&2
  exit 1
fi
if command -v plutil >/dev/null 2>&1; then
  plutil -lint "$TMP" >/dev/null
fi
mv "$TMP" "$OUT"
trap - EXIT
chmod 644 "$OUT"

echo "已產生：$OUT"
echo "  node    $NODE_BIN"
echo "  專案    $PROJECT_DIR"
echo "  log     $LOG_PATH"
if ! grep -Eq '^[[:space:]]*EVOMAP_HEARTBEAT_UNTIL=[^[:space:]]' "$PROJECT_DIR/.env" 2>/dev/null; then
  echo "提醒：$PROJECT_DIR/.env 沒有 EVOMAP_HEARTBEAT_UNTIL，心跳會改用 EVENT_ENDS_AT（都沒有就不限期）" >&2
fi

if [ "$LOAD" = 1 ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$OUT"
  echo "已載入 $LABEL"
else
  echo "尚未載入。要啟用："
  echo "  launchctl bootout gui/\$(id -u)/$LABEL 2>/dev/null; launchctl bootstrap gui/\$(id -u) \"$OUT\""
fi
echo "要停止並移除排程："
echo "  launchctl unload \"$OUT\"   # 或 launchctl bootout gui/\$(id -u)/$LABEL"
