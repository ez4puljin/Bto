# Runbook: installing the store edge on a new PC — Windows or Ubuntu (ADR-0067, ADR-0136)

Mongolian version with the update steps: [edge-install.mn.md](edge-install.mn.md).

The store edge (`deploy/edge/docker-compose.edge.yml`: `edge-db`, `edge`, `kiosk`) runs in Docker, so the PC needs only Docker and git — no Node or pnpm. A setup script writes `deploy/edge/.env` with fresh local secrets and starts the edge; the edge is then linked to the centre from its own kiosk page with a one-time code. Nobody copies a token or the PIN key by hand.

Until the centre goes live (S5, ADR-0026) the centre is the owner's dev server (`start.bat` on the owner's PC: `http://192.168.1.215:5173` or the api at `:3300`). This is a test setup: the scripts set `EBARIMT_PROVIDER=fake` and nothing reaches the tax office until the owner says otherwise.

## Overview

1. On the centre, «Супермаркет → Пос»: the store's edge server exists (create it once: code such as `MRN1`, name, the STORE warehouse).
2. On the new PC: install Docker and git, clone the repository, run the setup script (§ Windows or § Ubuntu).
3. Open `http://<new PC's address>:7400` → «Төв системтэй холбох»: the centre's address, the edge's code, the «Холбох код».
4. Pair each till («Холбох код» of the till), cashiers sign in with their PIN.

## Before moving an edge that already runs elsewhere

1. Close the open shifts on every till.
2. In «Супермаркет → Пос» check that the old edge's backlog is 0 (every sale replayed to the centre).
3. Stop the old edge (`pnpm edge:down` on the owner's PC, or `docker compose … down` there). Never run two edges for one edge server: the link gives the new one a fresh token and the old one stops at once.

Move at the start of a day, before the first sale: the new edge starts its own database, so its per-day sale numbers start again.

## Windows (10 or 11)

1. Install **Docker Desktop** (https://www.docker.com/products/docker-desktop/, or `winget install -e --id Docker.DockerDesktop`) and **Git** (`winget install -e --id Git.Git`). Restart when asked, open Docker Desktop once and wait until it says it is running. In Docker Desktop → Settings → General, tick «Start Docker Desktop when you sign in» so the edge comes back after a restart.
2. Clone the repository into a folder without spaces, e.g. `C:\bto`:

   ```text
   git clone https://github.com/ez4puljin/Bto.git C:\bto
   ```

3. Double-click `C:\bto\deploy\edge\setup-windows.bat`. The first run builds the images (10–20 minutes; plan on about 4 GB of memory and 10 GB of disk). It ends with `Бэлэн. Кассын хуудас: http://<address>:7400`.
4. To let the tills on other PCs in, run the same file once with right-click → «Run as administrator»: it opens the kiosk port in the Windows firewall.
5. Give the PC a fixed address (a DHCP reservation on the router): the tills keep that address.

## Ubuntu (22.04 or 24.04)

1. Install git and clone the repository:

   ```bash
   sudo apt update && sudo apt install -y git
   git clone https://github.com/ez4puljin/Bto.git ~/bto
   ```

2. Run the setup script. It installs Docker when it is missing (asks for the sudo password), writes the settings, builds and starts the edge (10–20 minutes the first time) and opens the kiosk port when `ufw` is on:

   ```bash
   bash ~/bto/deploy/edge/setup.sh
   ```

3. Give the PC a fixed address (a DHCP reservation on the router). Docker starts with the PC and the containers restart by themselves (`restart: unless-stopped`).

## Link the edge to the centre (both systems)

1. On the centre, «Супермаркет → Пос» → the edge server's row → **«Холбох код»** (the link icon). The window shows the code (`ABCD-EF23`, 15 minutes, shown once), the centre's address and the edge's code.
2. On any browser in the store, open `http://<edge PC's address>:7400`. A new edge shows **«Төв системтэй холбох»**:
   - «Төв системийн хаяг»: the centre's address as the window showed it. When it shows `localhost`, use the centre PC's LAN address instead, e.g. `http://192.168.1.215:5173` (the dev web, which passes `/api` on) or `http://192.168.1.215:3300` (the dev api).
   - «Edge серверийн код»: e.g. `MRN1`.
   - «Холбох код»: the code from step 1 (dashes and lower case are fine).
3. «Холбох»: the edge asks the centre for its token and the PIN key, keeps them in its own database, and pulls the store's data at once. The till pairing screen follows.
4. Each POS: open `http://<edge PC's address>:7400` and click the POS in the list («Пос сонгох»), or open `http://<edge PC's address>:7400/K1` (the POS's «Хаяг» on «Супермаркет → Пос») on that cashier's PC: it becomes POS К1 with no code (ADR-0138). Then the cashier signs in with the PIN. Without the path the page asks for the POS's six-digit «Холбох код» instead. A till's shortcut and printing: `pos-till-printing.md`.

Five wrong codes void the code in force; take a new one. If the centre's answer is «POS_PIN_PEPPER тохируулаагүй», the centre runs in production without `POS_PIN_PEPPER`: set it there first (ADR-0136 #4).

## Later

- **Update:** `git pull` in the repository, then the setup script again (it keeps `deploy/edge/.env` and the edge's data).
- **Logs:** `docker compose -f deploy/edge/docker-compose.edge.yml --env-file deploy/edge/.env logs -f --tail 100 edge` (from the repository folder).
- **Stop:** `docker compose -f deploy/edge/docker-compose.edge.yml --env-file deploy/edge/.env down`. Never add `-v`: it deletes the edge database with its unsent sales and its link.
- **A new token issued by hand** («Шинэ токен») stops a code-linked edge: its kiosk shows «Төв системтэй холбох» again (before a till is paired) — link it with a new code, to the same edge server.
- **The centre is off:** the tills keep selling; the sales wait in the edge's outbox and replay when the centre answers again.
- **The edge on the centre's own PC:** the address is `http://host.docker.internal:3300` (the container's name for the PC it runs on).
- **The real centre:** a linked edge does not move to another centre. When the real centre goes live, close the shifts, wait for backlog 0, remove the test edge with its data (`… down -v`), run the setup script again and link with a code from the real centre. Or fill `CENTRAL_API_URL`, `EDGE_NODE_TOKEN` and `POS_PIN_PEPPER` in `deploy/edge/.env` the old way, which overrides the kiosk's link.
