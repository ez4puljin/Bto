# Runbook: the store edge on a separate Ubuntu PC (ADR-0063, ADR-0067)

The store edge (`deploy/edge/docker-compose.edge.yml`: `edge-db`, `edge`, `kiosk`) runs in Docker, so the Ubuntu PC needs only Docker and git — no Node or pnpm. The tills then open `http://<Ubuntu PC's LAN address>:7400`; the edge replays its sales to the centre at `CENTRAL_API_URL`.

Until the centre goes live (S5, ADR-0026) the centre is the owner's dev server (`start.bat` on the owner's PC, api on port 3300). This is a test setup: keep `EBARIMT_PROVIDER=fake` until the owner says otherwise.

## 1. Before moving (on the PC that runs the edge now)

1. Close the open shifts on every till.
2. In «Супермаркет → Касс» check that the edge's backlog is 0 (every sale replayed to the centre).
3. Stop the old edge: `pnpm edge:down`. Never run two edges with one `EDGE_NODE_TOKEN`.
4. Copy `deploy/edge/.env` to a USB stick. It holds the edge's token and secrets: never send it by chat or e-mail and never commit it.

Move at the start of a day, before the first sale: the new edge starts its own database, so its per-day sale numbers start again.

## 2. Docker and git on Ubuntu

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 git
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
```

Log out and in again so the `docker` group applies. Give the PC a fixed address (a DHCP reservation on the router): the tills keep that address.

## 3. The code and the settings

```bash
git clone https://github.com/ez4puljin/Bto.git ~/bto
```

Put the copied file at `~/bto/deploy/edge/.env` and change one line to the centre's LAN address:

```text
CENTRAL_API_URL=http://<owner's PC LAN address>:3300
```

A fresh edge instead (no file to copy): `cp deploy/edge/.env.example deploy/edge/.env` and fill it in — `EDGE_NODE_TOKEN` from «Супермаркет → Касс → Шинэ токен» (a new token replaces the old one at once), `EDGE_JWT_SECRET` 32+ random characters (`openssl rand -hex 32`), `POS_PIN_PEPPER` the same as the centre's, a new `EDGE_DB_PASSWORD`.

Check that Ubuntu reaches the centre (it must answer; if not, the owner's PC is off, `start.bat` is not running, the PCs are on different networks, or the Windows firewall blocks node):

```bash
curl http://<owner's PC LAN address>:3300/health
```

## 4. Start

```bash
cd ~/bto && docker compose -f deploy/edge/docker-compose.edge.yml --env-file deploy/edge/.env up -d --build --wait
```

The first start builds both images on the PC (10–20 min; plan on about 4 GB of memory and 10 GB of disk). All three services restart with the PC (`restart: unless-stopped`). If the PC has a firewall:

```bash
sudo ufw allow 7400/tcp
```

Logs:

```bash
cd ~/bto && docker compose -f deploy/edge/docker-compose.edge.yml --env-file deploy/edge/.env logs -f --tail 100 edge
```

## 5. Pair the tills again

The new edge's database does not know the tills, so each till pairs once more: open `http://<Ubuntu PC's LAN address>:7400` in the till's Chrome (the shortcut in `pos-till-printing.md` §3 with the new address), enter a «Холбох код» from «Супермаркет → Касс» (valid 15 minutes), then the cashier signs in with the PIN. «Супермаркет → Касс» shows the edge's last-seen time.

## Later

- **Update:** `cd ~/bto && git pull`, then the start command of §4 again.
- **Stop:** `cd ~/bto && docker compose -f deploy/edge/docker-compose.edge.yml --env-file deploy/edge/.env down` (keeps the edge's data; never add `-v`, which deletes the edge database with its unsent sales).
- **The centre is off:** the tills keep selling; the sales wait in the edge's outbox and replay when the centre answers again.
- **The real centre:** when it goes live, change `CENTRAL_API_URL` to its address and run §4 again.
