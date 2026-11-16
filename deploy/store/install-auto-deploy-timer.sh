#!/usr/bin/env bash
# Installs auto-deploy.sh (ADR-0204) as a timer of the checkout's owner: a round every minute, so a
# push to main is on the real system a few minutes later without anyone running setup.sh. The
# update runs at a low priority (Nice 10, a small CPU and disk share) so the two apps keep their
# speed while images are built. No sudo; the account's services run without a login (linger).
# Run it from the real system's checkout (~/bto), never from ~/bto-dev. Safe to run again.
#
#   bash deploy/store/install-auto-deploy-timer.sh
#
# Afterwards:  bash deploy/store/auto-deploy.sh --check              what the next round would do
#              tail ~/.local/state/bto-deploy/auto-deploy.log        what the rounds did
#              systemctl --user disable --now bto-auto-deploy.timer  stop it
set -euo pipefail

if [ "$(id -u)" = "0" ]; then
  echo "sudo-гүйгээр ажиллуулна:  bash deploy/store/install-auto-deploy-timer.sh" >&2
  exit 1
fi
REPO=$(cd "$(dirname "$0")/../.." && pwd)
case "$REPO" in
  */bto-dev | */bto-dev/*)
    echo "Энэ бол хөгжүүлэлтийн хуулбар. Жинхэнэ системийн ~/bto-оос ажиллуулна." >&2
    exit 1
    ;;
esac
UNITS="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
export XDG_RUNTIME_DIR=${XDG_RUNTIME_DIR:-/run/user/$(id -u)}
mkdir -p "$UNITS"

cat >"$UNITS/bto-auto-deploy.service" <<UNIT
[Unit]
Description=Bto: put a new push of main on the real system (deploy/store/auto-deploy.sh)

[Service]
Type=oneshot
WorkingDirectory=$REPO
ExecStart=/usr/bin/env bash $REPO/deploy/store/auto-deploy.sh
Nice=10
CPUWeight=20
IOWeight=20
TimeoutStartSec=3600
UNIT

cat >"$UNITS/bto-auto-deploy.timer" <<UNIT
[Unit]
Description=Bto: look for a new push of main every minute

[Timer]
OnBootSec=3min
OnUnitInactiveSec=60s
AccuracySec=5s

[Install]
WantedBy=timers.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now bto-auto-deploy.timer
if [ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null)" != "yes" ]; then
  echo "АНХААР: нэвтрээгүй үед ажиллахгүй. Нэг удаа:  sudo loginctl enable-linger $(id -un)"
fi
echo "Push бүрийг минутын дотор харж, өөрөө тавина. Одоо юу хийхийг үзэх:  bash deploy/store/auto-deploy.sh --check"
systemctl --user list-timers bto-auto-deploy.timer --no-pager || true
