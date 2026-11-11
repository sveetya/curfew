# Curfew

A night curfew for the Windows laptop. A card sits in the top right corner and
counts down to 22:00, flips to **FINISH UP** for the last five minutes, then
Windows goes down. There is no cancel button. Getting out early needs a release
key that is not stored anywhere on the machine.

The point is not the shutdown. The point is that stopping becomes the default,
and every dodge leaves a record.

This is the Tauri rewrite of the PowerShell `LightsOut` app. Both read the same
kind of audit log, so an old log still parses in the console.

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

## Layout

```
curfew/
├── core/            Rust: state machine, schtasks args, audit log (no UI)
│   └── src/{curfew,schedule,audit}.rs
├── src/             React 19 + Tailwind v4 + hand-written shadcn primitives
│   ├── components/{CurfewCard,Console}.tsx
│   ├── lib/{format,log,bridge,mock,types}.ts
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

```bash
npm install
npm run dev          # http://127.0.0.1:1420/index.html and /console.html
npm run tauri dev    # the real Windows app
```

## Verify

```bash
npx tsc -p tsconfig.json --noEmit
npx vitest run                 # 20 tests: clock formatting, log parsing
cargo test -p curfew-core      # 26 tests: state machine, schtasks args, audit
npm run build
```

## Release

Push a tag; CI on `windows-latest` runs the tests, builds, signs and publishes:

```bash
git tag v0.1.0 && git push origin v0.1.0
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
