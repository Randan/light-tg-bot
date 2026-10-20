# light-tg-bot

Telegram bot that tells subscribers when the power goes off and on at one Kyiv home,
and what the DTEK outage schedule says. NestJS 10 + nestjs-telegraf, MongoDB Atlas.
User-facing text is Ukrainian; code, comments and commits are English.

## How it works

- **Power** (`light-cron.service.ts`): every `TUYA_POLL_INTERVAL_MINUTES` (3) asks the
  Tuya cloud whether the smart plug is online; online = power on. A change is recorded
  only after **two equal readings** (dated by the first) to ignore Wi-Fi blips. A failed
  Tuya call is UNKNOWN (`null`), never "power off". History in `light_history`.
- **Schedule** (`light-schedule.service.ts`, `yasno.service.ts`): every
  `YASNO_POLL_INTERVAL_MINUTES` (10) fetches today/tomorrow from the public YASNO API
  for the house's group, stores each distinct version in `outage_schedules`, notifies on
  changes. `/status` and power notifications add "вимкнуть/увімкнуть о HH:MM" only when
  the stored schedule is fresh.
- **Subscribers**: `/start` `/stop`, one document in `light_subscriptions`.
- **Admin** (`ADMIN_TELEGRAM_ID`): hidden `/statusrequest` (live Tuya check) and
  **`/diag`** (versions, last success/failure of Tuya and YASNO, address ids, group
  source). Admin alerts go through `FailureAlert`: once per interval + one "✅" on
  recovery.
- **Self-healing**: if the power poll loop finishes no round for 3 intervals, `/health`
  answers 503 and the watchdog alerts the admin and exits; Docker restarts it.

## External APIs and their traps

- **Tuya** Trial Edition: ~26k API calls/month (every 3 min ≈ 15k). One `TuyaContext`
  for the app lifetime (a new one per call fetched a token each time: 2× calls). The
  connector has no timeout; calls are wrapped in a 20 s timeout. Code `28841002` = the
  trial expired (renew in the Tuya console: Cloud → IoT Core → Extend Trial Period).
- **YASNO** (`https://app.yasno.ua/api/blackout-service/public/shutdowns`), unofficial,
  no key, cached 5 min. Kyiv = region 25, DTEK Kyiv = dso 902. Statuses:
  `ScheduleApplies | NoOutages | WaitingForSchedule | EmergencyShutdowns`. Slots are
  minutes from Kyiv midnight; a day without outages comes both as `[]` and as one
  `NotPlanned` slot, so compare outage ranges, not raw slots.
  - Since 2026-10-13 Kyiv schedules are **per building**: the group comes from the
    address (`addresses/v2/streets` → `houses` → `group`).
  - **Address ids are internal and change**: on 2026-10-17 YASNO renumbered every street
    and house (Тираспольська 962 → 896, house 54 40503 → 38502). That is why the address
    is configured **by name** (`YASNO_STREET`, `YASNO_HOUSE`) and ids are looked up again
    on a 404.
  - YASNO's bot protection (Incapsula) **blocks cloud IPs**: from a cloud session the
    address search fails, so do not conclude anything about ids from there. It works from
    the Pi and from the user's Mac.

## Running, testing, deploying

- `npm run lint`, `npm run format:check`, `npm run build`, `npm test` (`npm run test:cov`
  enforces the coverage threshold). Tests are pure unit tests with fakes, no network/DB.
- Every push to `master` runs the checks, then deploys to the Pi (R5oRR) over Tailscale:
  `git pull && GIT_SHA=… docker compose up -d --build`. Nothing deploys if a check fails.
- Runs on the Pi in `~/projects/light-tg-bot`, `network_mode: host`, port 4204. `.env`
  exists **only on the Pi** (see `.env.example`); it is not in git.
- Logs: journald driver, so they survive deploys: `docker logs light-tg-bot` or
  `journalctl CONTAINER_NAME=light-tg-bot`.

## Debugging without shell access (cloud session, phone)

1. Send `/diag` to the bot as the admin; it shows what the server would.
2. The Pi is reachable only via Tailscale (ask the user to turn it on); sudo needs the
   user's password.
3. Do not guess from a cloud session about YASNO ids or Tuya state: verify on the Pi or
   via `/diag`, and say what could not be verified.
