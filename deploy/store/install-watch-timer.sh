#!/usr/bin/env bash
# Installs the watchman (watch.sh, ADR-0195) as a timer of the checkout's owner: a round every
# minute, the first 90 seconds after the PC starts. No sudo: the owner is in the docker group and
# reads the backup folder, and the account's services run without a login (loginctl enable-linger).
# Safe to run again.
#
#   bash deploy/store/install-watch-timer.sh
#
# Afterwards:  systemctl --user list-timers bto-watch.timer    when it runs next
#              journalctl --user -u bto-watch -n 20            what the last rounds said
#              bash deploy/store/watch.sh --check              what it sees now
set -euo pipefail

if [ "$(id -u)" = "0" ]; then
  echo "sudo-гүйгээр, системийг суулгасан хэрэглэгчээр ажиллуулна:  bash deploy/store/install-watch-timer.sh" >&2
  exit 1
fi
REPO=$(cd "$(dirname "$0")/../.." && pwd)
UNITS="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
mkdir -p "$UNITS"

cat >"$UNITS/bto-watch.service" <<UNIT
[Unit]
Description=Bto: one round of the watchman (deploy/store/watch.sh)

[Service]
Type=oneshot
ExecStart=/usr/bin/env bash $REPO/deploy/store/watch.sh
Nice=10
TimeoutStartSec=120
UNIT

cat >"$UNITS/bto-watch.timer" <<UNIT
[Unit]
Description=Bto: the watchman every minute

[Timer]
OnBootSec=90s
OnUnitActiveSec=60s
AccuracySec=5s

[Install]
WantedBy=timers.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now bto-watch.timer
if [ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null)" != "yes" ]; then
  echo "АНХААР: энэ хэрэглэгчийн үйлчилгээ нэвтрээгүй үед ажиллахгүй. Нэг удаа:  sudo loginctl enable-linger $(id -un)"
fi
echo "Харуул минут тутам ажиллана. Одоо юу харж байгааг үзэх:  bash deploy/store/watch.sh --check"
systemctl --user list-timers bto-watch.timer --no-pager || true
