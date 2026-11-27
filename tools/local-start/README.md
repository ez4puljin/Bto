# Start the two existing local environments

From CMD in the installed Bto folder, run `start-main.cmd` for the original database
(`http://127.0.0.1:5173`) or `start-test.cmd` for the separate six-month QA database
(`http://127.0.0.1:5174`). Double-clicking either file also works. Keep each launcher window open.

The scripts use this checkout's existing portable Node 26/PostgreSQL 18, compiled API and installed
dependencies. They start only the existing PostgreSQL data directory if needed, reuse matching healthy
services, and never initialize, migrate, seed, reset or copy business data. An occupied/unresponsive
port fails visibly instead of stopping another process. Main/QA environment targets cannot be swapped.

QA requires its accepted historical manifest, private environment and existing password-ready admin.
The reviewed QA runtime restores its process-only clock immediately, so browsing uses today's date;
its outbound provider fence remains active. No password is placed in a launcher or command line.

Only child services created by the current launcher receive its IPC shutdown request on Ctrl+C or
parent disconnect. An already running service and PostgreSQL are retained. Partial startup failure
cleans up owned children; after a 15-second graceful shutdown timeout, only that exact owned child
may be terminated. Closing the whole console may cause Windows to terminate its console processes.
Logs are private ignored files under `.data/local-dev/local-start/`.


QA browsing uses a pre-provisioned `.data/local-dev/qa-six-month/qa.env`; it does not derive
credentials from the main application's environment. Its default login is `qa-admin`. Existing
installations with another QA login must explicitly set `BTO_QA_ADMIN_LOGIN` in that private QA
file before using the new source. The launcher verifies that account already has a password and
never creates or resets one. No environment file or accepted history is changed by publishing
these scripts. These Windows wrappers are not a production startup procedure for the Ubuntu host.
