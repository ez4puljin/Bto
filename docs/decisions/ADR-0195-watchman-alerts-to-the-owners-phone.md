# ADR-0195: A watchman on the PC tells the owner's phone when the system is in trouble

| | |
|---|---|
| Status | Accepted |
| Date | 2026-11-13 |
| Deciders | Owner (2026-11-13: «Тийм, эхэл» to phone alerts, the second item of the assessment after «Хөгжүүлэлтийн автоматжуулалт ба DevOps»), Claude (the direct-mode session) |
| Amends | ADR-0186 #7 (a failed backup is now said, not only written to `last-run.txt`), architecture §11 (Sentry stays the plan for the external server; until then this is what watches) |

## Context

Nothing told anyone when the centre was in trouble. The server panel (2026-11-13) shows the machine to whoever opens it; a failed backup writes a line in a file; a full disk, a stopped container or a refused report is in a log. On the day this was written the PC lost power at 15:26 and came back at 17:20: nobody knew for two hours, and the session found it by reading container ages. The system is about to carry the tills, the two apps and the office on one PC with one disk.

The owner maintains it alone and is reached by phone. The api cannot be the one that speaks: when it is down, it is the news.

## Decision

1. **A watchman outside the stack**: `deploy/store/watch.sh`, plain bash with curl and the Docker CLI, run every minute by a systemd timer of the checkout's owner (`install-watch-timer.sh`, no sudo; `setup.sh` installs it at every update). It needs nothing of the api, the database or Node to be alive.
2. **What it looks at**, each a line of Mongolian for the phone:
   - the centre's `/health` through the web's Caddy (web, api, database, job queue in one answer);
   - since 2026-11-14, the outside address: `https://<STORE_PUBLIC_HOST>/health`, asked the way a phone asks it, out to Cloudflare and back through the tunnel; reported after three rounds when nothing answers or when something that is not the centre answers, and not at all while the centre itself is down. Added the day a second PC on the LAN (192.168.1.152, running PRTG) ran cloudflared with this tunnel's token: Cloudflare sent every outside request to that PC, both apps and the outside web were cut off, and every check here stayed green;
   - the containers: `postgres`, `api`, `worker`, `web`, the configured number of `api-apps` and `api-reports` (ADR-0192), and the till server's three when it is installed; a missing, stopped or unhealthy one is named;
   - the disk of `/` and of the backup folder at `STORE_ALERT_DISK_PERCENT` (85 %);
   - memory under 5 % available;
   - the nightly backup: `last-run.txt` saying FAILED, or older than `STORE_ALERT_BACKUP_HOURS` (26);
   - the last ten minutes of the api processes' logs: `STORE_ALERT_ERROR_COUNT` (10) server errors, or any report refused by the gate (ADR-0193: the sign that its numbers are too small), and a log that cannot be read whole (below);
   - the PC having started again, with how long nothing was watching.
3. **Said once, repeated rarely, closed once.** A problem is told when it starts (after two rounds in a row for the ones a restart causes: an update's minute is not news), again every `STORE_ALERT_REMIND_HOURS` (6) while it lasts with how long it has lasted, and «🟢 Зассан» when it is over. A problem that ended before it was told ends silently. A message that could not be sent is not counted as said and goes out when the network is back. The memory is one small file per problem under `~/.local/state/bto-watch`.
4. **To the owner's own Telegram bot.** `alerts-setup.sh` is run by the owner on the PC: it asks for the bot's token hidden, finds the chat of whoever then writes to the bot, keeps both in `deploy/store/.env` (`STORE_ALERT_TELEGRAM_TOKEN`, `STORE_ALERT_TELEGRAM_CHAT`) and sends a test. The token is a secret of the box like the others: never printed, never on a command line (curl reads it from standard input), never given to a session. Without it the watchman looks and stays silent.
5. **The messages carry the machine's state only**: which part, how full, how long. No customer, amount, document or user name leaves the PC this way.
6. **The PC being off is the one thing it cannot say.** `STORE_ALERT_HEARTBEAT_URL` (optional) is called after every round; a dead man's switch service behind it speaks when the calls stop. Until the owner sets one, a power cut is learned when the PC is back («PC дахин аслаа. … орчим унтарсан байсан»).
7. **The logs are read from the end, never by a window.** A power cut leaves a hole of unwritten bytes in a container's json log file, and Docker's reader, which parses from the start, stops at it: on 2026-11-13 `docker logs --since 10m` answered «nothing» for the primary api and the edge, both of which were serving all the while, and only `--tail` passed the hole. A read long enough to cross it degrades the same way, so the watchman reads `--tail 2000`, and when that brings nothing recent it tries `--tail 200`: a short read that comes back newer proves the hole, and its lines are counted instead of none. The hole is reported too (🟡), because a log the watchman cannot read whole is a blind spot in itself; recreating the container (either `setup.sh`) gives it a fresh file.
8. **Tried without the world**: `deploy/store/watch.test.sh` runs the memory (start, repeat, end, an unsent message, a new start) with a made-up clock and sender; CI's `deploy-config` job runs it. `watch.sh --check` prints what it sees now and sends nothing; `--test` sends one message.

## Alternatives considered

| Alternative | Why rejected |
|---|---|
| Alerts sent by the api or the worker (a job) | The watcher dies with what it watches: the two worst cases, the api down and the database down, would be silent. |
| Sentry, Grafana with Alertmanager, Uptime Kuma | Each another service to run, update and secure on the one PC, or an account abroad holding error payloads; Sentry remains the plan for the external server (architecture §11). A hundred lines of bash cover what this PC can go wrong with. |
| E-mail or SMS | No mail server and no SMS anywhere in the system (ADR-0079); Telegram is on the owner's phone already and its bot API is one HTTPS call. |
| An outside monitor only (a service pinging `https://app.puljika.site/health`) | Sees «down» and nothing else: not the disk, the backup, a missing replica or refused reports; and the name answers Mongolia only (ADR-0189). It is the right tool for the PC being off: #6 leaves the door open. |
| A message at every round while a problem lasts | Sixty messages an hour teach the owner to mute the chat. |

## Consequences

**Positive.** The owner hears of a stopped part, a filling disk, a failed backup or refused reports within a minute or two, and hears when it is over; a restart of the PC is reported with its length; the gate's and the pool's numbers can be tuned from what the phone says; no new service, image or dependency.

**Negative.** The log checks are a count over the newest lines, not over the window exactly: a minute busy enough to fill 2000 lines undercounts, and a damaged log is read 200 lines deep until the container is recreated. One more secret on the box, and messages that go through Telegram's servers (machine state only). The thresholds are guesses until a few weeks of real use. The watchman reads ten minutes of five containers' logs every minute: cheap today, to be watched when the logs grow. It runs as the checkout's owner: a box where that user is not in the `docker` group or cannot read the backup folder would report those as problems. A power cut is still silent while it lasts until a heartbeat URL is set.

**Follow-ups.**
- A dead man's switch for the PC being off (the owner's choice of service), and the UPS question it raises.
- The deploy that waits for CI, keeps the previous image and rolls the replicas one at a time (the assessment's next item).
- The watchman's findings on the server panel, and the deadlock retries (ADR-0190) and gate counts (ADR-0193) among them.
- The till server's own facts: the outbox's age, the PosAPI's reach.
- Whether the centre should keep its own log of errors instead of being read out of Docker's.

## Related

ADR-0186, ADR-0187, ADR-0189, ADR-0192, ADR-0193, `deploy/store/watch.sh`, `deploy/store/watch.test.sh`, `deploy/store/alerts-setup.sh`, `deploy/store/install-watch-timer.sh`, `deploy/store/.env.example`, `docs/runbooks/store-install.md` §11, `docs/architecture.md` §11.
