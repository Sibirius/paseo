#!/usr/bin/env bash
# Records Android Back in a compact workspace on an emulator, for the upstream v0.12.0 app
# (before) and this branch's Paseo Debug build (after), and replays the agent-device flow
# against both. Expects PASEO_HOME (a running daemon with relay on), WORKSPACE_ID, PAIR_URL,
# and both APKs installed.
set -uo pipefail

OUT="${OUT:-$PWD/recordings}"
FLOW="${FLOW:-packages/app/e2e/mobile/agent-device/native-compact-workspace-back.android.ad}"
SERVER_ID="${SERVER_ID:-$(cat "$PASEO_HOME/server-id")}"
OFFER="${PAIR_URL#*#}"
mkdir -p "$OUT"

focus() { adb shell dumpsys window | grep -m1 -E 'mCurrentFocus' | sed 's/^ *//'; }
shot() {
  adb exec-out screencap -p >"$OUT/$1.png"
  echo "$1: $(focus)" | tee -a "$OUT/steps.txt"
}
back() { adb shell input keyevent KEYCODE_BACK; sleep 2.5; }
snap() { agent-device snapshot --session "${1%%-*}" >"$OUT/$1.snapshot.txt" 2>&1 || true; }

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

# A slow emulator can show "<app> isn't responding" on first launch; keep waiting.
dismiss_anr() {
  local session="$1"
  for _ in 1 2 3; do
    if agent-device is visible 'text="Wait"' --session "$session" >/dev/null 2>&1; then
      echo "$session: app not responding dialog, pressed Wait" | tee -a "$OUT/steps.txt"
      agent-device press 'text="Wait"' --session "$session" >/dev/null 2>&1
      sleep 10
    else
      return 0
    fi
  done
}

open_workspace() {
  local pkg="$1" name="$2"
  agent-device open "$pkg" --platform android --session "$name" >/dev/null
  sleep 20
  dismiss_anr "$name"
  adb shell am start -W -a android.intent.action.VIEW -d "paseo://welcome#${OFFER}" "$pkg" >/dev/null
  sleep 5
  dismiss_anr "$name"
  if ! agent-device wait 'text="Connect"' 30000 --session "$name" >/dev/null; then
    shot "$name-0-no-connect-prompt-first"
    adb shell am start -W -a android.intent.action.VIEW -d "paseo://welcome" "$pkg" >/dev/null
    if ! agent-device wait 'text="Connect"' 30000 --session "$name" >/dev/null; then
      shot "$name-0-no-connect-prompt"
      return 1
    fi
  fi
  shot "$name-0-connect-prompt"
  agent-device press 'text="Connect"' --session "$name" >/dev/null
  # The host's workspaces arrive after the connection; opening the workspace before
  # they do leaves the route on "Loading workspace".
  if ! agent-device wait 'text="Demo"' 60000 --session "$name" >/dev/null; then
    agent-device press 'id="menu-button"' --session "$name" >/dev/null 2>&1
    agent-device wait 'text="Demo"' 30000 --session "$name" >/dev/null 2>&1
  fi
  shot "$name-0-connected"
  snap "$name-0-connected"
  adb shell am start -W -a android.intent.action.VIEW \
    -d "paseo://h/${SERVER_ID}/workspace/${WORKSPACE_ID}" "$pkg" >/dev/null
  if ! agent-device wait 'id="workspace-header-menu-trigger"' 45000 --session "$name" >/dev/null; then
    shot "$name-1-link-did-not-open"
    snap "$name-1-link-did-not-open"
    agent-device press 'id="menu-button"' --session "$name" >/dev/null 2>&1
    sleep 2
    agent-device press 'text="Demo"' --session "$name" >/dev/null 2>&1
    if ! agent-device wait 'id="workspace-header-menu-trigger"' 45000 --session "$name" >/dev/null; then
      shot "$name-1-no-workspace"
      snap "$name-1-no-workspace"
      return 1
    fi
  fi
  sleep 3
  shot "$name-1-workspace"
}

check() {
  local name="$1" label="$2"
  shift 2
  if agent-device "$@" --session "$name" >/dev/null 2>&1; then
    echo "$name check: $label: yes" | tee -a "$OUT/steps.txt"
  else
    echo "$name check: $label: no" | tee -a "$OUT/steps.txt"
  fi
}

fresh_start() {
  local pkg="$1" session="$2"
  adb shell am force-stop "$pkg"
  sleep 2
  agent-device open "$pkg" --platform android --session "$session" >/dev/null
  sleep 10
  dismiss_anr "$session"
  agent-device wait 'id="workspace-header-menu-trigger"' 45000 --session "$session" >/dev/null
  agent-device wait stable 1000 15000 --session "$session" >/dev/null 2>&1
}

walk_back() {
  local pkg="$1" name="$2" session="$2-walk"
  fresh_start "$pkg" "$session"
  shot "$name-2-chat"
  check "$session" "workspace list closed at the start" wait absent 'id="agent-list-backdrop"' 3000
  start_recording
  agent-device press 'id="workspace-explorer-toggle"' --session "$session" >/dev/null
  check "$session" "file explorer open" wait 'id="file-explorer-backdrop"' 10000
  sleep 1
  shot "$name-3-explorer-open"
  back
  check "$session" "explorer closed after Back" wait absent 'id="file-explorer-backdrop"' 5000
  check "$session" "still in the chat (no workspace list)" wait absent 'id="agent-list-backdrop"' 3000
  shot "$name-4-after-back-from-explorer"
  back
  check "$session" "workspace list open after Back from the chat" wait 'id="agent-list-backdrop"' 5000
  shot "$name-5-after-back-from-chat"
  back
  shot "$name-6-after-third-back"
  stop_recording "$name"
  agent-device close --session "$session" >/dev/null 2>&1 || true
}

replay() {
  local pkg="$1" name="$2"
  sed "s/^env APP_ID=.*/env APP_ID=${pkg}/" "$FLOW" >"$OUT/$name-flow.ad"
  adb shell am force-stop "$pkg"
  sleep 2
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
  if open_workspace "$1" "$2"; then
    agent-device close --session "$2" >/dev/null 2>&1 || true
    walk_back "$1" "$2"
    replay "$1" "$2"
  else
    echo "$2: could not open the workspace, skipping" | tee -a "$OUT/steps.txt"
    agent-device close --session "$2" >/dev/null 2>&1 || true
  fi
  adb shell am force-stop "$1"
done
cat "$OUT/steps.txt"
