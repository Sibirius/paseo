#!/usr/bin/env bash
# Records Android Back in a compact workspace on an emulator, for the upstream v0.12.0 app
# (before) and this branch's Paseo Debug build (after), and replays the agent-device flow
# against both. Expects PASEO_HOME (a running daemon with relay on), WORKSPACE_ID, PAIR_URL,
# and both APKs installed.
set -uo pipefail

OUT="${OUT:-$PWD/recordings}"
FLOW="packages/app/e2e/mobile/agent-device/native-compact-workspace-back.android.ad"
SERVER_ID="$(cat "$PASEO_HOME/server-id")"
OFFER="${PAIR_URL#*#}"
mkdir -p "$OUT"

focus() { adb shell dumpsys window | grep -m1 -E 'mCurrentFocus' | sed 's/^ *//'; }
shot() {
  adb exec-out screencap -p >"$OUT/$1.png"
  echo "$1: $(focus)" | tee -a "$OUT/steps.txt"
}
back() { adb shell input keyevent KEYCODE_BACK; sleep 2.5; }

start_recording() {
  adb shell rm -f /sdcard/rec.mp4
  adb shell screenrecord --bit-rate 6000000 --time-limit 120 /sdcard/rec.mp4 &
  REC_PID=$!
  sleep 2
}
stop_recording() {
  sleep 1
  adb shell pkill -INT screenrecord || true
  wait "$REC_PID" 2>/dev/null || true
  sleep 2
  adb pull /sdcard/rec.mp4 "$OUT/$1.mp4" >/dev/null
}

open_workspace() {
  local pkg="$1" name="$2"
  agent-device open "$pkg" --platform android --session "$name" >/dev/null
  sleep 5
  adb shell am start -W -a android.intent.action.VIEW -d "paseo://pair#${OFFER}" "$pkg" >/dev/null
  sleep 20
  shot "$name-0-paired"
  adb shell am start -W -a android.intent.action.VIEW \
    -d "paseo://h/${SERVER_ID}/workspace/${WORKSPACE_ID}" "$pkg" >/dev/null
  agent-device wait 'id="workspace-header-menu-trigger"' 60000 --session "$name" >/dev/null ||
    echo "$name: workspace header did not appear"
  sleep 3
  shot "$name-1-workspace"
}

walk_back() {
  local name="$1"
  start_recording
  shot "$name-2-chat"
  agent-device press 'id="workspace-explorer-toggle"' --session "$name" >/dev/null
  sleep 2.5
  shot "$name-3-explorer-open"
  back
  shot "$name-4-after-back-from-explorer"
  back
  shot "$name-5-after-back-from-chat"
  back
  shot "$name-6-after-third-back"
  stop_recording "$name"
}

replay() {
  local pkg="$1" name="$2"
  sed "s/^env APP_ID=.*/env APP_ID=${pkg}/" "$FLOW" >"$OUT/$name-flow.ad"
  adb shell monkey -p "$pkg" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  adb shell am start -W -a android.intent.action.VIEW \
    -d "paseo://h/${SERVER_ID}/workspace/${WORKSPACE_ID}" "$pkg" >/dev/null
  sleep 5
  if agent-device replay "$OUT/$name-flow.ad" --platform android --session "$name-replay" \
    >"$OUT/$name-replay.log" 2>&1; then
    echo "$name replay: PASS" | tee -a "$OUT/steps.txt"
  else
    echo "$name replay: FAIL (exit $?)" | tee -a "$OUT/steps.txt"
  fi
  tail -n 25 "$OUT/$name-replay.log"
}

for app in "sh.paseo before" "sh.paseo.debug after"; do
  set -- $app
  echo "== $2 ($1)"
  open_workspace "$1" "$2"
  walk_back "$2"
  replay "$1" "$2"
  agent-device close --session "$2" >/dev/null 2>&1 || true
  adb shell am force-stop "$1"
done
cat "$OUT/steps.txt"
