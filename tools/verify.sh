#!/usr/bin/env bash
# One-shot browser verification: real Chrome, real DOM, scripted scenarios.
#
#   ./tools/verify.sh                 # engine + gen + play + hint + save/resume + layout
#   SCENARIOS="play hint" ./tools/verify.sh
#   BASE_URL=https://z-biz-game.github.io/z-biz-game-akari-cos/ ./tools/verify.sh
#
# Do NOT add --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader: software
# rasterisation saturates every core and, with no CDP client attached, Chrome will not exit
# on its own.
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
PORT=${CDP_PORT:-9349}
# 5173 is Xcode/ashen-ring's default and a long-lived server there will happily serve a
# *different* app, so this harness deliberately uses its own port. Other agents in this repo
# farm run their own verify.sh at the same time; 5247 is akari's and nothing else's.
HTTP=${HTTP_PORT:-5247}
BASE=${BASE_URL:-http://127.0.0.1:$HTTP/}

# ---- 逻辑闸（纯 node，不开浏览器）：排在找 Chrome、起服务之前 ----
# 三道闸各把自己的"体量"钉在下面这一行。为什么要钉：rc=0 看不出闸变窄——明天有人删掉 20 条
# 断言，只要剩下的还是绿的，整道闸一样 exit 0。所以每条闸实跑出来的条数必须逐条对上这里的钉，
# 改闸就要同时改这一行（doctest 自己在 D16a/D16b 里也钉了同一组数，两处必须一致）。
FAILED=0
LOGIC_EXPECTS="engine-test:77 doctest:16/165 sabotage:5"
pin_of() { printf '%s\n' "$LOGIC_EXPECTS" | tr ' ' '\n' | grep "^$1:" | cut -d: -f2; }
LOGIC_LOG=$(mktemp)

node "$HERE/tools/engine-test.mjs" >"$LOGIC_LOG" 2>&1 || FAILED=1
ET=$(sed -n 's/^\([0-9]*\) 通过 \/ \([0-9]*\) 失败.*/\1/p' "$LOGIC_LOG" | head -1)
if [ "$ET" = "$(pin_of engine-test)" ]; then
  echo "逻辑闸 engine-test：$ET 条（钉 $(pin_of engine-test)）✓"
else
  echo "逻辑闸 engine-test 体量 $ET != 钉的 $(pin_of engine-test)（rc 之外还要对条数；改断言要同步 LOGIC_EXPECTS）" >&2
  grep 'FAIL' "$LOGIC_LOG" | head -10 >&2
  FAILED=1
fi

echo "=== 逻辑闸 tools/doctest.mjs（文档 == 代码 / balance / engine-test 现跑）==="
node "$HERE/tools/doctest.mjs" >"$LOGIC_LOG" 2>&1 || FAILED=1
grep '^  FAIL' "$LOGIC_LOG" | head -25
DS=$(sed -n 's/^GATE_SIZE groups=\([0-9]*\) rows=\([0-9]*\) fail=\([0-9]*\).*/\1\/\2/p' "$LOGIC_LOG" | head -1)
if [ "$DS" = "$(pin_of doctest)" ]; then
  echo "  doctest：${DS%/*} 组 / ${DS#*/} 项（钉 $DS）✓"
else
  echo "  doctest 体量 ${DS:-未打印 GATE_SIZE} != 钉的 $(pin_of doctest) —— 闸变窄或跑不起来都是红" >&2
  FAILED=1
fi

echo "=== 逻辑闸 tools/sabotage.mjs（破坏试验台账：每一类谎都要把对应断言逼红）==="
node "$HERE/tools/sabotage.mjs" || { echo "  sabotage 红：某一类破坏没能把对应断言逼到失败" >&2; FAILED=1; }
rm -f "$LOGIC_LOG"

CHROME=${CHROME_BIN:-}
if [ -z "$CHROME" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "/Applications/Chromium.app/Contents/MacOS/Chromium" \
           google-chrome chromium chromium-browser; do
    if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then CHROME=$c; break; fi
  done
fi
[ -x "$CHROME" ] || { echo "no Chrome found; set CHROME_BIN" >&2; exit 2; }

LOCAL=0
case "$BASE" in "http://127.0.0.1:$HTTP/"*) LOCAL=1 ;; esac
SPID=0
if [ "$LOCAL" = 1 ]; then
  node "$HERE/server.cjs" "$HTTP" >/tmp/akari-server.log 2>&1 &
  SPID=$!
  for i in $(seq 1 40); do
    curl -fsS -m 1 "http://127.0.0.1:$HTTP/" >/dev/null 2>&1 && break
    sleep 0.25
  done
fi
# Pre-flight: prove the bytes we are about to test are this app's, not some other repo's
# index.html served on the same port.
SERVED=$(curl -fsS -m 3 "$BASE" 2>/dev/null || true)
case "$SERVED" in *js/main.js*) ;; *) echo "nothing served at $BASE (see /tmp/akari-server.log)" >&2; exit 2 ;; esac
echo "$SERVED" | grep -qi akari || { echo "port $HTTP is serving a different app, not akari" >&2; exit 2; }

UDD=$(mktemp -d)
"$CHROME" --headless=new --remote-debugging-port=$PORT --user-data-dir=$UDD \
  --window-size=900,900 --no-first-run --no-default-browser-check about:blank >/tmp/akari-chrome.log 2>&1 &
CPID=$!
cleanup() {
  [ "$SPID" != 0 ] && kill $SPID 2>/dev/null
  kill -9 $CPID 2>/dev/null
  rm -rf $UDD
}
trap cleanup EXIT
# The watchdog redirects its fds: a background subshell inherits this script's stdout, and
# inside a pipeline it would hold the write end open long after the tests finished.
( sleep ${WD_TIMEOUT:-420}; cleanup ) </dev/null >/dev/null 2>&1 & WD=$!

# A fresh --user-data-dir binds DevTools later than a warm profile: wait on the endpoint.
for i in $(seq 1 120); do
  curl -fsS -m 1 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 && break
  sleep 0.5
done
curl -fsS -m 2 "http://127.0.0.1:$PORT/json/version" >/dev/null 2>&1 || {
  echo "devtools never bound on :$PORT" >&2; exit 3; }

export CDP_PORT=$PORT
export BASE_URL=$BASE
cd "$HERE"
node tools/playtest.cjs open "$BASE" | head -5

BOOT=""
for i in $(seq 1 60); do
  BOOT=$(node tools/playtest.cjs eval "window.akari?window.akari.version:'nope'" nonav 2>/dev/null | tr -d '\n" ')
  case "$BOOT" in *nope*|"") sleep 0.5 ;; *) break ;; esac
done
echo "boot: akari $BOOT at $BASE"
[ "$BOOT" = "nope" ] && { echo "window.akari never appeared at $BASE" >&2; exit 4; }

# FAILED 已在本脚本开头的逻辑闸段落初始化为 0（浏览器循环再清一次会把逻辑闸的红擦掉）。
for s in ${SCENARIOS:-engine gen play hint save resume layout}; do
  echo "=== $s ==="
  node tools/playtest.cjs scenario "$s" 2>/tmp/akari-$s.console.log | tail -1 | sed 's/^RESULT //' | python3 -c "
import sys, json
raw = sys.stdin.read().strip()
if not raw:
    print('  NO RESULT (see /tmp/akari-$s.console.log)'); sys.exit(1)
try:
    d = json.loads(raw)
except Exception as e:
    print('  UNPARSED:', raw[:300]); sys.exit(1)
for r in d['rows']:
    if not r['pass']: print('  FAIL %-46s %s' % (r['test'], r['detail']))
extra = {k: v for k, v in d.items() if k not in ('rows', 'fail')}
if not d['rows']:
    print('  NO CHECKS RUN — a scenario that asserts nothing cannot be green'); sys.exit(1)
print('  %d checks, %d failed  %s' % (len(d['rows']), d['fail'], extra if extra else ''))
sys.exit(1 if d['fail'] else 0)
" || FAILED=1
  if [ -s /tmp/akari-$s.console.log ]; then
    echo "  --- console ---"
    sed 's/^/  /' /tmp/akari-$s.console.log | tail -12
  fi
done

if [ -n "${SHOTS:-}" ]; then
  mkdir -p tools/shots
  for shot in menu board win; do
    case $shot in
      menu) node tools/playtest.cjs eval "window.akari.show('menu');'ok'" nonav >/dev/null 2>&1 ;;
      board) node tools/playtest.cjs eval "window.akari.begin({tier:'regular',seed:'shot-board'});for(let i=0;i<6;i++)window.akari.useHint();'ok'" nonav >/dev/null 2>&1 ;;
      win) node tools/playtest.cjs eval "window.akari.begin({tier:'apprentice',seed:'shot-win'});window.akari.solveWithLogic();'ok'" nonav >/dev/null 2>&1 ;;
    esac
    sleep 1.4
    node tools/playtest.cjs shot tools/shots/$shot-$SHOTS.png >/dev/null
  done
  echo "shots: $(ls tools/shots/*-$SHOTS.png | tr '\n' ' ')"
fi

kill $WD 2>/dev/null
[ $FAILED -eq 0 ] && echo "=== ALL GREEN ===" || echo "=== FAILURES ABOVE ==="
exit $FAILED
