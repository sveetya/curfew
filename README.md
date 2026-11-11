# Curfew

A night curfew for the Windows laptop. A card sits in the top right corner and
counts down to the shutdown time (22:00 by default), flips to **FINISH UP** for the last five minutes, then
Windows goes down. There is no cancel button. Getting out early needs a release
key that is not stored anywhere on the machine.

The point is not the shutdown. The point is that stopping becomes the default,
and every dodge leaves a record.

This is the Tauri rewrite of the PowerShell `LightsOut` app. Both read the same
kind of audit log, so an old log still parses in the console.

## Install (Windows)

Download the `.exe` from [Releases](https://github.com/sveetya/curfew/releases),
run it, and the console opens. The nightly task is created on the first save in
Settings. The card appears by itself at 21:30.

After that, updates install themselves: the app checks the signed
`latest.json` manifest on launch and offers the new build. The repo has to stay
**public** for that — the updater fetches the manifest without credentials.

The two keys live in Proton Pass, vault `MARA`: *Curfew updater signing key* and
*Curfew release key*. Nothing that matters is recoverable from this repo.

## What a night looks like

| Time | Card | What is happening |
|---|---|---|
| 21:30 | NIGHT CURFEW, counting | Task Scheduler starts `curfew.exe --card`. Nothing enforced yet. |
| 21:55 | FINISH UP, amber | Countdown hit zero. Five minutes to save, commit, close. |
| 22:00 | gone | `shutdown /s /t 0` fires. |

Grace is carved out of the countdown, not added on top, so shutdown stays at
22:00. Change it in the console; the task is rewritten on save.

## The three buttons

**Wait 10.** Before 21:55 it moves the real deadline. During FINISH UP the same
press is booked as *borrowed* grace, and each borrowed window is repaid by
starting two minutes earlier. That debt is logged. Without it a snooze turns a
curfew into a suggestion.

**Release.** Asks for the release key. A wrong key locks the prompt for five
minutes, so guessing costs clock instead of being free. Case, spaces and hyphens
are ignored.

**Shut down now.** Aborts anything Windows had queued, then goes down.

## The release key

The build stores a SHA-256 hash, never the key:

```
CURFEW_RELEASE_HASH=<hex> npm run tauri build
```

Unset means the Release button always refuses — the safe default. To set a key,
hash the normalised form (upper case, no spaces or hyphens):

```bash
python3 -c "import hashlib,sys; print(hashlib.sha256(b'NIGHT-OWL-7391').hexdigest())"
```

Then put that hex in the repo secret `CURFEW_RELEASE_HASH`. Change the key by
rebuilding; nothing on the laptop can recover it.

### The key also guards the clock

The same key gates the schedule. Changing the card time, the shutdown time or
the grace length asks for it; the battery / wake / autostart switches do not.
That is deliberate: a curfew you can push back at 21:50 by clicking a spinner is
not a curfew. A wrong key locks the prompt for five minutes, exactly like the
Release button, and the attempt lands in the audit log as
`schedule change FAILED`.

A build with no `CURFEW_RELEASE_HASH` can neither release nor be rescheduled —
the settings page says so instead of pretending to save.

## Layout

```
curfew/
├── core/            Rust: state machine, schtasks args, audit log (no UI)
│   └── src/{curfew,schedule,audit}.rs
├── src/             React 19 + Tailwind v4 + hand-written shadcn primitives
│   ├── components/{CurfewCard,Console}.tsx
│   ├── lib/{format,log,bridge,mock,config,types}.ts
│   └── styles/{theme,global}.css
├── src-tauri/       Tauri 2 shell: tray, commands, capabilities, config
└── .github/workflows/{ci,release}.yml
```

`src/lib/bridge.ts` is the only door to the backend. In a browser (`npm run
dev`) it calls `src/lib/mock.ts`, a TypeScript twin of the state machine, so the
UI can be reviewed on Linux with no Rust toolchain. The console says
"Preview — no Windows backend attached" when that is happening, and the card
carries a `preview` chip, so a preview screenshot is never mistaken for a real
night.

## Develop

Node **26** is pinned three ways: `engines` in `package.json`, `.nvmrc` and
`.node-version`. Dependencies are installed with **pnpm** — the version is pinned
by `packageManager`, so `pnpm` self-selects it.

```bash
pnpm install
pnpm dev             # http://127.0.0.1:1420/index.html and /console.html
pnpm tauri dev       # the real Windows app
```

## Verify

```bash
pnpm check                      # biome + tsc + vitest, the same order CI runs
pnpm lint                       # Biome: lint and format check
pnpm lint:fix                   # Biome: apply safe fixes
pnpm exec tsc -p tsconfig.json --noEmit   # TypeScript 7.0.2, pinned
pnpm test                       # 25 tests: clock formatting, log parsing, schedule gating
pnpm rust:test                  # clippy -D warnings + 26 core tests
cargo clippy -p curfew-core --all-targets -- -D warnings
pnpm build
```

Biome is the formatter and linter for everything under `src/` plus the root
configs; Tailwind's at-rules are enabled explicitly in `biome.json` so
`theme.css` is checked rather than skipped.

## Release

Push a tag; CI on `windows-latest` runs the same gates, then builds, signs and
publishes:

```bash
git tag v0.1.2 && git push origin v0.1.2
```

Secrets the workflow needs:

| Secret | What |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | contents of the minisign private key |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | its password (empty if none) |
| `CURFEW_RELEASE_HASH` | optional; unset = release disabled |

The updater reads
`https://github.com/sveetya/curfew/releases/latest/download/latest.json`
and refuses any artifact whose signature does not match the pubkey in
`src-tauri/tauri.conf.json`.

## Honest limits

- A guardrail, not a cage. Task Manager ends the process, and closing the card
  hides a run without writing a summary.
- It cannot make you stop working, and it cannot make you sleep. It makes
  stopping the default and makes dodging visible.
- The Rust shell has been reviewed and unit-tested only through `core/`. The
  Tauri glue (windows, tray, commands) compiles on CI, not here: this machine
  has no `glib-2.0`/WebKit. Treat the first real night as a test.
- If Windows already has a shutdown pending, our `shutdown /a` aborts it.
