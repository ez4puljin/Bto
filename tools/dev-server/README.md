# The development server on the Ubuntu PC

Since 2026-11-12 (ADR-0187) Bto is developed on the Ubuntu PC `nvme-server@192.168.1.250`, in the
checkout `~/bto-dev`. There the development server is a systemd user service instead of `start.bat`
and its «Bto dev» window (which stay for a Windows PC).

| | |
|---|---|
| Unit | `tools/dev-server/bto-dev.service`, installed as `~/.config/systemd/user/bto-dev.service` |
| What it runs | `pnpm db:migrate`, then `pnpm dev` with `DEV_LAN=1` (Vite on every interface) |
| Address | `http://<the PC's LAN address>:5173` (the firewall lets 5173 in) |
| Status / restart / stop | `systemctl --user status bto-dev`, `systemctl --user restart bto-dev`, `systemctl --user stop bto-dev` |
| Log | `journalctl --user -u bto-dev -f` |
| Starts with the PC | yes: the unit is enabled and the user lingers (`loginctl enable-linger`) |

The development PostgreSQL is the repository's `docker-compose.yml` (project `tugeel`, container
`tugeel-postgres-1`, `127.0.0.1:15432`): `docker compose up -d --wait` once; it restarts by itself.
`tools/dev-db` is for a Windows PC and is not used here.

Stop the service before a full `pnpm check` and start it again afterwards: both build
`packages/*/dist`, and the load makes the integrity suite time out.

Over SSH without a login shell, name Node's folder and the user's runtime folder first:

```bash
export PATH="$HOME/.local/opt/node/bin:$PATH" XDG_RUNTIME_DIR=/run/user/$(id -u)
```

## The staff app in a browser (`bto-mobile-web`)

A second user service, `tools/dev-server/bto-mobile-web.service`, runs `pnpm mobile:web`: Expo's
dev server bundles the staff app for the web and reloads it on every saved change, and a small
proxy on `127.0.0.1:8090` (`apps/mobile/scripts/web.mjs`) passes `/api` and `/health` to the
development api on 3300. It listens on this PC only (the firewall is unchanged): from the laptop
open an SSH tunnel and then `http://localhost:8090` in Chrome (F12 → the phone toolbar for a phone's
size); localhost is a secure page, so the browser gives the position and `crypto.randomUUID`.

```bash
ssh -N -L 8090:127.0.0.1:8090 nvme-server@192.168.1.250
```

It is for looking at the screens and their flows with the development data. A phone's own parts are
not there: the APK update, the fingerprint, the camera scanner as on a phone; the sign-in is kept
only until the tab closes (sessionStorage). Status, restart and log as for `bto-dev`
(`systemctl --user status bto-mobile-web`, `journalctl --user -u bto-mobile-web -f`). It never talks
to the real system: the script refuses an api that is not a development port on this PC.

## Setting it up on another Linux PC

1. Node 26 in `~/.local/opt/node` (the unit's `PATH` names it) and `npm i -g pnpm@11.28.2`; Docker
   with Compose; the checkout in `~/bto-dev`; `apps/api/.env` from `apps/api/.env.example`.
2. `docker compose up -d --wait`, `pnpm install`, `pnpm db:provision`.
3. Install and start the service:

   ```bash
   mkdir -p ~/.config/systemd/user
   cp tools/dev-server/bto-dev.service ~/.config/systemd/user/
   systemctl --user daemon-reload
   systemctl --user enable --now bto-dev
   sudo loginctl enable-linger "$USER"
   ```

## Never from here

The same PC carries the real system in `~/bto` (the centre on port 80, the tills on 7400, its
PostgreSQL on `127.0.0.1:15433`; ADR-0186, ADR-0187). Nothing in `~/bto-dev` names port 15433, and
no `docker compose … down -v` is run on this PC.
