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
