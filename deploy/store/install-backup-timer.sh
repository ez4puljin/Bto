#!/usr/bin/env bash
# Installs the nightly backup of the store's Ubuntu PC as a systemd timer (ADR-0186 #7): every
# night at 02:30 (the box's time, Asia/Ulaanbaatar), and at the next start when the PC was off.
# Safe to run again.
#
#   sudo bash deploy/store/install-backup-timer.sh
#
# Afterwards:  systemctl list-timers bto-backup.timer     when it runs next
#              sudo systemctl start bto-backup.service     run it now
#              cat /var/backups/bto/last-run.txt           what the last run did
set -euo pipefail

if [ "$(id -u)" != "0" ]; then
  echo "sudo-оор ажиллуулна:  sudo bash deploy/store/install-backup-timer.sh" >&2
  exit 1
fi
REPO=$(cd "$(dirname "$0")/../.." && pwd)

cat >/etc/systemd/system/bto-backup.service <<EOF
[Unit]
Description=Bto: nightly backup of the centre and the edge (deploy/store/backup.sh)
Wants=docker.service
After=docker.service

[Service]
Type=oneshot
ExecStart=/usr/bin/env bash $REPO/deploy/store/backup.sh
Nice=10
IOSchedulingClass=idle
EOF

cat >/etc/systemd/system/bto-backup.timer <<EOF
[Unit]
Description=Bto: nightly backup at 02:30

[Timer]
OnCalendar=*-*-* 02:30:00
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now bto-backup.timer
echo "Нөөцлөлт шөнө бүр 02:30-д ажиллана. Одоо нэг удаа турших:  sudo systemctl start bto-backup.service"
systemctl list-timers bto-backup.timer --no-pager || true
