#!/bin/zsh
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CODEX_NODE="/Applications/Codex.app/Contents/Resources/node"

if command -v node >/dev/null 2>&1; then
  NODE_BIN="$(command -v node)"
elif [ -x "$CODEX_NODE" ]; then
  NODE_BIN="$CODEX_NODE"
else
  echo "Node.js was not found. Install Node or run this from Codex's bundled Node environment." >&2
  exit 1
fi

case "$1" in
  start)
    exec "$NODE_BIN" "$ROOT/scripts/local-start.js"
    ;;
  stop)
    exec "$NODE_BIN" "$ROOT/scripts/local-stop.js"
    ;;
  open)
    exec "$NODE_BIN" "$ROOT/scripts/local-open.js"
    ;;
  restart)
    "$NODE_BIN" "$ROOT/scripts/local-stop.js"
    exec "$NODE_BIN" "$ROOT/scripts/local-start.js"
    ;;
  install-autostart)
    exec "$NODE_BIN" "$ROOT/scripts/local-autostart.js" install
    ;;
  uninstall-autostart)
    exec "$NODE_BIN" "$ROOT/scripts/local-autostart.js" uninstall
    ;;
  *)
    echo "Usage: ./scripts/local-app.sh start|stop|open|restart|install-autostart|uninstall-autostart"
    exit 1
    ;;
esac
