# QCEX Hetzner sandbox

Host: `<SERVER_IP>` (osmrouter). App directory: `/opt/osmrouter/infra/web/quantellics/qcex`.
Public URL: https://qcex.quantellics.com

Run from the app directory:

```sh
docker compose --env-file .env -f deploy/compose.hetzner.yaml up -d --build --wait --wait-timeout 180
docker compose --env-file .env -f deploy/compose.hetzner.yaml ps
```

Docker installs pinned Node/npm, Java/Maven and MySQL dependencies. The separate `qcex_mysql-data` volume retains server data. Never remove volumes during routine updates. `.env` contains independently generated server database credentials and must remain mode 0600 and untracked. Transfer only source files; do not copy local credentials, sessions, backups or databases.

The web container joins `osmrouter_default` as `qcex-web`; the existing Caddy edge proxies this domain to `qcex-web:3100`. MySQL, API and market-data have no published host ports. The application allows the configured HTTPS origin and issues Secure session cookies. The web-root checkout is blocked at `quantellics.com/qcex*` to prevent source/config exposure.

After launching, seed the remote synthetic demo from a workstation with repository dependencies installed:

```powershell
$env:QCEX_BASE_URL = 'https://qcex.quantellics.com'
node scripts/seed-demo.mjs
$env:TEST_URL = $env:QCEX_BASE_URL
npx playwright test tests/launchpad.spec.ts tests/wallet.spec.ts
# Run the login/navigation suite after the authentication throttle window clears.
npx playwright test tests/demo.spec.ts tests/responsive.spec.ts
Remove-Item Env:QCEX_BASE_URL, Env:TEST_URL
```

Demo: `qcex_demo` / `QCEX_Demo_2026!`, fixed verification `123456`. This remains a synthetic sandbox with demonstration verification, not real-money trading or production MFA. The public demo is shared: users can alter its orders and holdings. Seeding resumes missing commands and does not reset activity.

Caddy configuration: `/opt/osmrouter/infra/Caddyfile`. The pre-deployment backup is `Caddyfile.before-qcex-app`. For app rollback, restore the preceding app source/image version and run Compose again without deleting the database volume. Retain the `/qcex*` source-access block when changing the edge configuration.
