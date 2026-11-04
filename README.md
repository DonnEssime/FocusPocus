# FocusPocus

A local-first time tracker and focus booster. All user data lives in one **vault** on disk, a small folder of files meant to sit in a synced folder such as Google Drive. Every change goes through a typed **command log**. That log is the only source of truth, and it is what makes undo/redo, auditing and backward-compatible file versioning possible.

This README is the architecture guide. Read it before changing code. The command/log model comes from the sibling project `../TTCBTornooiApp`. The rules below keep what worked there and fix what did not scale.

## Quick start

Requires Node.js 22+ and a desktop Chromium browser (Chrome or Edge).

```bash
npm install
npm run dev          # http://localhost:5173/FocusPocus/
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server for the web app |
| `npm test` | Vitest unit and integration tests (kernel, vault, modules, guards) |
| `npm run check` | TypeScript (root) + `svelte-check` (web) |
| `npm run test:e2e` | Playwright end-to-end tests against the dev server |
| `npm run build:web` | Production build to `web/dist/` (deployed to GitHub Pages) |

**Dev-only vaults:** in development, `?opfs=<name>` opens a throwaway vault in the browser's private file system (OPFS) instead of showing the folder picker. The end-to-end tests use this. Production builds ignore it.

---

## 1. Product scope (current)

| Module | Purpose |
| --- | --- |
| `timetrack` | Calendar-style time tracking (day/week/month), tagged blocks, simple statistics. See §10.2. |
| `focus` | Simple focus timer: one countdown with a background sound and a finishing sound. See §10.1. |
| `app` (core) | Settings shared by everything: language, theme, layout, module config. |

Modules are **independent**. They do not read each other's state or issue each other's commands. Today each one is shown as a tab. The shell must not assume this, because later we may show modules side by side or in a layout the user arranges (see §6).

---

## 2. Stack and repository layout

The default stack matches the reference project:

- **Target:** a static website for desktop Chromium browsers (Chrome, Edge). It needs the File System Access API (`showDirectoryPicker`) and has no server. Mobile is out of scope.
- **Hosting:** GitHub Pages (`<user>.github.io/FocusPocus/`), the same setup as TTCBTornooiApp. A GitHub Actions workflow runs `npm ci && npm run build:web` on every push to `main` and deploys `web/dist`. Consequences:
  - Vite's `base` must be `/FocusPocus/`. Asset paths are always relative to `base`, never absolute.
  - The page is purely static. User data never leaves the user's machine: it goes only to the local vault folder, which the user's own sync client may upload. Don't add analytics or network calls that involve user data.
  - Pages are served over HTTPS, which the File System Access API requires (`localhost` also counts as secure during development).
  - Show the build info (version, commit hash, date) in the footer, as the reference does, so it's clear which deploy is running.
- **Domain:** plain TypeScript with no framework imports and no DOM. Tested with Vitest.
- **UI:** Svelte 5 + Vite. It is a thin layer over the domain.
- **E2E:** Playwright.

```
src/
  core/                   framework-free kernel (no DOM, no Svelte)
    command/              envelope + ids, hybrid clock, CommandRunner (apply, merge, undo/redo, checkpoints)
    vault/                on-disk format, segment codec, Vault (write/read/poll/compact), VaultSession, BroadcastChannel port
    storage/              StorageBackend interface + in-memory backend (tests)
    i18n/                 locales, catalog types, resolver, core + shell catalogs
    module.ts             ModuleDefinition / CommandDef contract + ModuleRegistry
    session.ts            Session: builds envelopes, dispatch, per-module undo/redo, listeners
  modules/
    app/                  app-wide settings (theme, language, later layout)
    timetrack/            commands, state, catalog
    focus/                same shape
  registry.ts             composition root: the only file that lists every module and catalog
web/
  src/
    shell/                vault picker and opening, Shell, LayoutHost, StatusBar, session store, contexts
    storage/              File System Access backend, IndexedDB vault pointer
    theme/                tokens, registry, themes/ (the only place colours may appear)
    i18n/                 <Msg>, msgText(), current locale
    modules/<id>/         Svelte panels per module (import only their own domain module)
  e2e/                    Playwright specs
tests/                    Vitest specs; tests/helpers has test modules and a Drive-like sync simulator
tests/fixtures/vaults/    frozen vaults per format version (planned; never edited, only added)
```

The web app imports the domain code through the `@focuspocus/*` alias (`→ src/*`).

**File size discipline.** The reference ended up with a 7k-line `App.svelte` and a 5.5k-line `model.ts`. Don't repeat that. Split by module and by concern before a file grows past roughly 500 lines. A component that a reader can't take in at once should be broken up.

---

## 3. The command model

### 3.1 Everything is a command

All persistent state changes, including settings like language and theme, go through commands. UI code never mutates domain state directly and never writes files.

```ts
interface Command<T extends string = string, P = unknown> {
  id: string;          // "<writer>.<seq>": globally unique without coordination (see §3.5)
  t: T;                // namespaced type: "tt.StartEntry", "focus.StartSession", "app.SetLayout"
  v: number;           // payload schema version for this command type (see §5)
  at: number;          // epoch ms (UTC), strictly monotonic per writer
  deps?: string[];     // explicit dependencies (ids) for dependency-aware undo
  p: P;                // payload
}
```

On disk the keys are short (`t`, `p`, `at`) because there may be millions of lines. In code, use readable names and map them at the serialization boundary only.

### 3.2 Runner contract

- `execute(cmd) → CommandResult`, where the result is `{ ok: true } | { ok: false; reason: MessageKey; params? }`. Failures are i18n keys, never English strings, as in the reference.
- **Validate, then apply.** A rejected command is never written.
- **Apply functions are pure and deterministic.** No `Date.now()`, `Math.random()` or locale reads inside them. Any value they need (timestamps, random salts, generated ids) is captured in the payload when the command is created. Replaying the same log must always produce the same state.
- **Immutable state.** `apply(state, payload, ctx)` returns a *new* state object and never mutates its input. Structural sharing is fine and encouraged: copy only the part that changed, and shard big collections (for example blocks by month) so that a copy stays small. This is what makes batches atomic and in-memory checkpoints cheap.
- **Incremental apply.** The reference rebuilt all state from the full log on every command, which is O(n) per command. That's fine for one tournament, not for years of time tracking. Here, local commands are applied incrementally to the current state. Undo/redo and commands merged into the middle of the order replay only from the nearest **in-memory checkpoint** before the affected position. The runner keeps a checkpoint every 256 commands, thinned to at most 64, dense for recent history and sparse for old history.
- **Monotonic clock.** `at = max(now, lastAt + 1)` per writer. The reference had real bugs from same-millisecond ordering. The global order is `(at, writer, seq)`. Clocks on different computers can disagree, so this order is only approximately the real one. When order matters for correctness, use `deps`, not timestamps.

### 3.3 Undo / redo

We keep the reference's design and make it fully append-only:

- **Undo is a command:** `core.Undo { target }`. It hides the target, and everything that transitively `deps` on it, during replay.
- **Dependency-aware.** You can't undo a command while active later commands depend on it, unless the undo cascades and the UI shows the user which commands will go with it.
- **Redo is also a command:** `core.Undo` aimed at an earlier `core.Undo`. The reference did redo by *popping* the trailing Undo line, which rewrites the log. That breaks append-only storage and sync, so we never delete log lines.
- **Undo scope.** Each module has its own undo stack, and the `app` module has one too. Undo in the time-tracker tab never reverts a focus-timer action. The log is shared, so scoping is done by the command's namespace.
- **Coalescing.** Some UI actions issue many commands (a drag that edits several entries). Wrap them in a single `core.Batch { cmds }` or link them with a shared `group` id, so one undo reverts the whole action.
- Commands that should never be undone (for example, purely informational ones) declare this in their definition.

### 3.4 Dependencies

Declare `deps` explicitly when a command refers to an entity created by another command. For example, `tt.EditEntry` depends on the `tt.StartEntry` that created the entry. Helpers that work out dependencies belong next to the command definitions, as `seedingDepsFor…` did in the reference. Don't recompute them ad hoc in the UI.

### 3.5 Identifiers

- **Writer id:** a short random id (about 8 base36 chars) that a window generates when it opens a vault. It is never stored outside the vault and does not identify a computer. Its only job is to give each concurrent writer its own file namespace (§4.5).
- **Command and entity ids:** `<writer>.<base36 seq>`. They are compact and unique without any coordination between writers.

---

## 4. Storage: the vault

### 4.1 Requirements that drive the design

1. **Sync-friendly.** Drive-style clients re-upload a *whole file* whenever it changes, and they create conflict copies or silently keep the last writer's version when two machines edit the same file. So we keep the files that get written small, and **no two writers ever write the same file** (§4.5).
2. **Few writes.** Batch writes, and never write on a timer tick. A running timer is stored as a start event, not as elapsed time.
3. **Scales to years of data** without loading everything. Loading uses snapshots, and old data can be read without parsing all of history.
4. **Hundreds of files are fine; millions are not.** Files are grouped by time period and compacted, never one file per entity.
5. **Inspectable.** A human can open it with standard tools (JSON lines, gzip).

### 4.2 Layout

```
<vault>/                                   e.g. ~/Google Drive/FocusPocus.vault/
  vault.json                               format version, vault id, created-at. Rarely rewritten.
  log/
    live/
      2026-11-04.<writer>.0.jsonl          ACTIVE segment of one open window (append-only)
      2026-11-03.<writer>.0.jsonl          closed by its writer, waiting for compaction
    2026-10.<hash>.jsonl.gz                COMPACTED month: union of all writers, immutable
    ...
  snapshots/
    2026-10.<hash>.snap.json.gz            derived state at the end of a compacted month (a cache)
```

- **Live segments:** each open window appends to its own file, named `<UTC day>.<writer>.<n>.jsonl`. The file is created lazily on the first write, so a window that only reads never creates one. It starts a new file each day and whenever it reopens; it never resumes appending to an old file. Only the writer that owns a file ever writes to it. Live segments stay small (one window, one day), so each sync upload is small.
- **Compaction:** when a month is over, one window merges the closed live segments for that month into a single gzip-compressed, immutable month file named by content hash. It writes that file first and only then deletes the sources. The vault therefore stays at a few hundred files: one per month plus the recent live ones.
- **First line of every segment** is a header: `{"t":"core.SegmentHeader","format":N,"app":"x.y.z","w":"…"}`. This follows the reference's `TournamentLogHeader`. A writer that closes a segment cleanly appends a `core.SegmentClosed` line as the last line.
- **Loading** reads every `*.jsonl` / `*.jsonl.gz` under `log/`, takes the union deduplicated by command id, and sorts it by `(at, writer, seq)`. Data can arrive late through sync, for example an older command from another computer that only now appears. That case triggers a rebuild from the latest snapshot that comes before it.
- **Snapshots** *(not implemented yet: loading currently replays the whole log, with in-memory checkpoints only)* are a cache and can always be thrown away. A snapshot records which month files it covers and carries its own `snapshotVersion`. If either doesn't match, ignore the snapshot and replay. Snapshots are written only by compaction, which happens rarely.
- **`vault.json`** holds nothing that changes often. Settings live in the log as `app.*` commands, not here.

### 4.3 Write policy

- Commands are applied in memory immediately. Persisting them is **coalesced**: debounce about 2 s, wait at most about 10 s, and flush right away on `visibilitychange → hidden`, `pagehide`, and before closing a segment. Each flush is one append write to this window's own segment.
- State transitions such as starting or stopping a timer must reach disk quickly. That is covered by the max-wait and flush-on-hide rules above. Do not add per-second writes.
- **The UI never touches files.** It talks to a `StorageBackend` interface (`list`, `read`, `append`, `writeNew`, `remove`, `stat`). Implementations: the File System Access API (a directory handle) for real use, and in-memory for tests. The in-memory backend can simulate sync delays and conflict copies.
- **Note on appends:** with the File System Access API, `createWritable({ keepExistingData: true })` writes to a temporary copy and swaps it in on `close()`. Each flush therefore costs one whole-file write, which is another reason live segments stay small.

### 4.4 What lives outside the vault

Only the **pointer to the vault**. Everything else (language, theme, layout, module settings) is inside the vault as commands.

- The pointer is a `FileSystemDirectoryHandle` saved in **IndexedDB**, under one key. A web page has no access to real filesystem paths, and a handle can't be serialized into a cookie, so IndexedDB is the only place it can live. Don't store anything else there, and don't use cookies or localStorage at all.
- Permission to use the handle doesn't survive a browser restart. On startup, call `queryPermission`. If it says `prompt`, show a one-click "Reopen <vault name>" button that calls `requestPermission`, which only works after a user click. Also offer "Choose another vault".
- Before a vault is open (the picker screen), the UI uses the default theme and language (§7).

### 4.5 Concurrent writers: multiple windows, multiple computers

The same vault may be open in several browser windows and on several computers **at the same time**. Locks can't be shared across computers through Drive, and sync can lag by minutes. So correctness must never depend on being the only writer. The design is therefore **conflict-free by construction**:

1. **Never share a file between writers.** Each window has its own writer id and appends only to its own live segment. Two writers can't overwrite each other's commands, even before sync catches up.
2. **Never mutate a file after it's done.** Closed segments and compacted months are immutable. The only deletion is compaction removing sources that are already contained in a month file written earlier.
3. **The merge is a set union.** Command ids are globally unique, so loading deduplicates by id. A duplicate (a compaction race, or a Drive conflict copy such as `… (1).jsonl`) is harmless: the loader just reads it as well. Two computers compacting the same month at the same time produce two month files with the same content, and the next compaction merges them.
4. **Compact only what is certainly finished.** A live segment may be compacted only if it ends with `core.SegmentClosed`, or if it hasn't changed in over 7 days (its writer crashed). Writers start a new file each day, so a live writer never has an open file that old. Use the Web Locks API (`navigator.locks`) so that only one window per browser compacts at a time. Across computers, rule 3 makes duplicate compaction safe.
5. **Pick up other writers' changes.** Windows in the same browser announce each new command over `BroadcastChannel`, so updates there are instant. Changes from other computers are found by polling `log/` for new or grown files, using a cheap `stat` about every 15 s and on window focus, then reading only what changed. Polling only reads, never writes.
6. **Handle semantic conflicts on replay.** Concurrent edits can clash, for example two computers each starting a timer, or one editing an entry that the other deleted. Replay never throws on these. If a command fails validation against the merged state, it is marked **rejected-on-merge**: it is kept in the log, skipped during apply, and shown to the user to review. Each module defines its own sensible rules in its apply functions. For example, starting a new time entry stops the running one at the new entry's `at`.
7. **Undo across writers.** An Undo can target a command written by another writer, because undo works by command id and dependencies, not by file. Each window builds its per-module undo stack from the merged log.

---

## 5. Versioning and compatibility

There are three independent version numbers. Never mix them up:

| Version | Where | Bump when |
| --- | --- | --- |
| **App version** (semver) | `package.json`, `APP_VERSION` | Releases: patch = fixes, minor = features, major = breaking UX. |
| **Vault format version** | `vault.json`, segment headers, `VAULT_FORMAT_VERSION` | The container changes: layout, encoding, header shape, sort rules. |
| **Command schema version** (`v`) | per command type | A payload's shape or meaning changes. |

Rules:

- **Never rewrite history.** Closed segments and compacted months are immutable. Old commands are upgraded *on read* by per-type **upcasters** (`v1 → v2 → …`) that run before apply. An upcaster is a pure function and is tested against frozen fixtures.
- **Additive changes** (a new optional field with a default) don't need a `v` bump. A change of meaning needs a new `v` and an upcaster, or a new command type.
- **Forward compatibility.** If an app finds a format version or command `v` newer than it knows, it opens the vault **read-only** and says why. It must never write into a vault it doesn't fully understand. Unknown command *types* from a newer module are kept in the log and skipped during apply, never dropped. This happens in practice: GitHub Pages deploys on every push, so a window that's been open for days can be running an old build while another computer is already on the new one. When polling finds newer data, the window switches to read-only and offers a reload.
- **Fixtures are a contract.** Each format version adds a frozen vault under `tests/fixtures/vaults/vN/`. A test loads every fixture and checks the resulting state. Fixtures are only ever added, never edited.
- Migrations that change the vault format run once, write new files, and keep the old ones until the user confirms. A migration never destroys data in place.

---

## 6. Modules and layout

Each feature is a **module** with one contract:

```ts
interface ModuleDefinition<S> {
  id: string;                               // "timetrack": state slice key and undo scope
  ns: string;                               // "tt": command type prefix (tt.CreateBlock)
  initialState(): S;
  commands: Record<string, CommandDef<S>>;  // { v, undoable, upcast?, apply }
  catalog: MessageCatalog;                  // module's i18n strings, keys prefixed "<id>."
  // planned: snapshot: { version; encode(s); decode(x) }, for on-disk snapshots (§4.2)
}
```

- The **core** knows nothing about the modules. It sends each command to its module by namespace prefix. Each module's state is a separate slice: modules never read another module's slice, and a module's commands never depend on another module's commands.
- On the UI side, each module provides **panels** (`{ id, module, titleKey, component }`). The shell renders a **layout tree** from the vault (`app.SetLayout`), for example `tabs[timetrack, focus]` today and maybe `split(h, [timetrack, focus])` later. Panels must not assume they fill the whole screen or are the only thing visible.
- A shared need between modules (such as "a timer is running" for the title bar) goes through a core-level read-only selector interface. Modules never import each other.

---

## 7. Theming and i18n

**Current scope:** one theme (**Dark**, the default) and one language (**English**). There is no UI to choose either one yet. Both are still built as registries, so adding a theme or a language means adding data files, not changing components.

### 7.1 Themes

```
web/src/theme/
  tokens.ts          ThemeToken union: the complete list of semantic tokens
  themes/dark.ts     ThemeDefinition for "dark"
  registry.ts        THEMES = { dark }, DEFAULT_THEME_ID = 'dark', resolveTheme(id?)
  applyTheme.ts      writes tokens as CSS custom properties on <html>, sets data-theme + color-scheme
```

```ts
interface ThemeDefinition {
  id: string;                          // "dark"
  labelKey: MessageKey;                // name shown in a future picker
  colorScheme: 'dark' | 'light';       // drives CSS `color-scheme` for native controls/scrollbars
  tokens: Record<ThemeToken, string>;  // every token is required, so the compiler enforces completeness
}
```

- **Semantic tokens only.** Name tokens by role: `--surface`, `--surface-raised`, `--text`, `--text-muted`, `--border`, `--accent`, `--danger`, `--focus-work`, `--focus-break`, and so on. Never name them by colour, as in `--blue-500`. Components and module panels use `var(--token)` only.
- **No hard-coded colours** (hex, `rgb()`, named colours) in `.svelte` or `.css` outside `themes/`. A test enforces this.
- **Adding a theme** means one new file in `themes/` plus one registry entry. Nothing else should change.
- **Choosing the theme:** `resolveTheme(state.app.themeId)` falls back to `DEFAULT_THEME_ID` when the id is missing or unknown, for example a vault saved by a newer build with more themes. The picker screen, shown before a vault is open, also uses the default theme. To prevent a flash of the wrong theme, the dark tokens are applied in `index.html` before the app mounts.

### 7.2 Languages

As in the reference:

```
src/core/i18n/
  locales.ts         SUPPORTED_LOCALES = ['en'] as const; type Locale; DEFAULT_LOCALE = 'en'
  types.ts           MessageEntry = { en: string } & Partial<Record<Exclude<Locale,'en'>, string>>
  catalog.ts         merges core + every module's catalog; type MessageKey = keyof typeof catalog
  resolve.ts         msg(key, params, locale): fallback to `en`, {param} interpolation
  format.ts          dates/times/durations/numbers via Intl.* for the active locale
src/modules/<id>/catalog.ts   each module owns its strings, keys prefixed "<id>."
web/src/i18n/Msg.svelte, msg.ts   <Msg key=… /> in markup, msgText() in script
```

- All user-visible strings are catalog keys. **English is required for every key.** Other languages may be missing an entry. A missing entry falls back to English, and dev builds mark it visibly.
- Domain code returns `MessageKey` and params, never formatted text.
- **Adding a language** means adding its code to `SUPPORTED_LOCALES` and filling in entries. A coverage spec reports missing translations as warnings only.
- **Choosing the language:** the language is resolved from vault state, falling back to `DEFAULT_LOCALE`. Once there is more than one language, the picker screen will choose from `navigator.language`. Until then it uses `en`.
- Dates, times and durations are formatted through one shared formatter that knows the locale. Store UTC ms and format in local time. Commands whose meaning depends on the calendar day (for example "entry for Tuesday") also carry the IANA timezone or UTC offset that applied when they were recorded.

### 7.3 Settings commands come later

`app.SetTheme` and `app.SetLanguage` are **not** defined yet. Adding a command type later is an additive change and needs no format bump (§5). Until then, `app` state carries `themeId` and `locale` set to their defaults, so everything already reads the theme and language through the resolvers.

---

## 8. Development workflow

- **TDD:** write or adjust a failing test first, then make the smallest change that passes it.
- **Semantic micro-commits:** `feat:`, `fix:`, `test:`, `refactor:`, `chore:`, `docs:`. One behaviour per commit. Never mix refactors with feature work.
- **Tests that must exist for every command type:** validate (accepts and rejects), apply, replay determinism (replay(log) == incremental state), undo/redo round-trip, and serialization round-trip. Add an upcaster test whenever `v` changes.
- **Storage tests** run against the in-memory backend. They cover multiple windows and computers writing at the same time with delayed sync, late arrivals, Drive conflict copies, two compactions racing, writers that crash without closing their segment, snapshot invalidation, rejected-on-merge commands, and read-only mode for newer formats.
- **Performance budget:** opening a vault with about a million commands across snapshots should stay interactive in under 1 s. A benchmark spec guards this.
- **Bump the app version** only for releases. Bump the vault format version only for genuinely breaking container changes, and only together with a fixture and a migration.

---

## 9. Lessons carried over from TTCBTornooiApp

| Keep | Change |
| --- | --- |
| Typed command union, command-result with i18n reason keys | Namespaced per module; registry instead of one giant `switch` |
| Append-only log + format header | Per-writer live segments, compacted into immutable gzip months; merged by id-deduplicating union; no full-file rewrites |
| Undo as a command, dependency-aware | Redo is also a command (Undo-of-Undo), never a log pop; per-module undo scope |
| Monotonic timestamps | Plus writer id and seq for a total order across concurrent writers |
| Single user, single window | Safe with multiple windows and computers open at once (§4.5) |
| Deterministic replay (salts in payloads) | Incremental apply + snapshots instead of a full rebuild per command |
| Separate app vs. storage format version | Plus per-command schema versions with upcasters and frozen fixtures |
| TDD, micro-commits, semver discipline | Same |
| | Settings (incl. language) live in the data file, not localStorage |
| | Small files: no multi-thousand-line components or models |

---

## 10. Module specifications

### 10.1 `focus`: focus timer

A deliberately minimal timer. Not in scope: automatic breaks, cycles, sound uploads, volume control.

#### Behaviour

| Action | What happens |
| --- | --- |
| **Start** | The countdown starts from the configured length and the chosen ticking sound loops in the background. |
| **Countdown reaches 0** | The ticking stops, the chosen finishing sound plays once, and the panel resets to idle. |
| **Stop** | The ticking stops at once. No sound plays and nothing else changes in the UI; the panel just resets to idle. |
| **Idle** | Shows the configured length and the Start button. |

There is only one session at a time. While it runs, the button reads Stop.

#### Panels

The module provides two panels (§6). The default layout places them as sub-tabs of the Focus tab: `tabs[timetrack, tabs[focus.timer, focus.settings]]`.

- **`focus.timer`:** a large `mm:ss` countdown and a single Start/Stop button.
- **`focus.settings`:**
  - **Length:** whole minutes from 1 to 180, default 25.
  - **Ticking sound:** a dropdown.
  - **Finishing sound:** a dropdown.
  - Choosing an entry in either dropdown plays a short preview of about 3 s, which fades out. Picking another entry stops the current preview first. A preview never affects a running timer.

#### Sounds

The sounds are a fixed set that ships with the app, kept in a registry the same way as themes (§7.1). Adding a sound means adding one file and one registry entry:

```ts
interface SoundDefinition {
  id: string;                       // stored in settings; never reuse an id for a different sound
  kind: 'ticking' | 'finishing';
  labelKey: MessageKey;
  src: string;                      // relative asset path under base (§2 hosting)
}
```

| Kind | Initial set |
| --- | --- |
| `ticking` (looped) | `clock-tick` (default), `rainforest-rain` |
| `finishing` (once) | a few bell chimes, e.g. `bell-single` (default), `bell-triple`, `chime-soft` |

- **Assets** live in `web/src/modules/focus/sounds/` as mono Ogg/Opus, about 220 KB for the whole set; a test keeps it under 400 KB. Ticking sounds must loop without an audible seam.
- **Generated, not recorded:** the current files are synthesized by `scripts/generate-sounds.mjs`. The script is deterministic and needs `ffmpeg` with libopus to run. Loops are built to be periodic: tick events sit inside the loop, and noise layers are cross-faded circularly. The output is original work, released under CC0.
- **Replacing a sound with a recording:** keep the same id and file name.
- **Licensing:** use only CC0 or similarly unrestricted recordings. Record each file's source and licence in `sounds/LICENSES.md`; a test checks that every sound has a row there.
- **Fallbacks:** an unknown sound id in settings (for example one from a newer build) falls back to that kind's default sound, in the same way as `resolveTheme`.

#### Commands

| Command | Payload | Undoable |
| --- | --- | --- |
| `focus.SetSettings` | partial `{ durationMin?, tickingSoundId?, finishingSoundId? }` | yes |
| `focus.Start` | `{ startedAt, durationMs, tickingSoundId, finishingSoundId }` | no |
| `focus.Stop` | `{ sessionId, stoppedAt }`, with `deps` on the Start | no |

- **Session ids:** the session id is the id of its `focus.Start` command.
- **Wall-clock times:** `startedAt` and `stoppedAt` are the wall-clock times on the computer that issued them. They deliberately don't use the command's hybrid-clock `at`. If another computer's clock runs ahead, that clock pushes `at` forward, which would stretch the timer.

- **Settings are copied into the session.** `focus.Start` stores the length and sounds in its payload, so changing settings while a timer runs only affects the next session. Replay never depends on the current settings.
- **Completion writes nothing.** A session counts as finished when `now ≥ startedAt + durationMs` and no Stop exists. Only Start and Stop are written, at most two writes per session. History stays reconstructable: a session that has no Stop ran to the end.
- **The settings form commits on `change`, not on every keystroke or slider step.** Each commit is one command, so one undo step.
- **No undo for Start/Stop.** Undoing a running or finished timer has no sensible meaning, so the Focus undo stack contains only settings changes.
- **Stop is lenient.** Stopping a session that already ended, was already stopped, or was replaced is a no-op, not a rejected-on-merge conflict. Such stops are common after merges and harmless.

#### Timing and audio rules

- **Remaining time comes from the clock:** `startedAt + durationMs - now`. Never decrement a counter, because browsers throttle timers in background tabs. The display refreshes with `requestAnimationFrame` or a 250 ms interval while the window is visible.
- **Schedule the end on the audio clock.** When the session starts, schedule the finishing sound and the end of the ticking loop on the Web Audio clock (`AudioContext.currentTime + remaining`). This keeps the end exact in background tabs. Stop cancels both.
- **Autoplay:** browsers only allow audio after a user action. Create or resume the `AudioContext` inside the Start and preview click handlers.
- **Sounds play in one window per browser:**
  - Only the window that started the session plays its sounds.
  - Other windows, and other computers that see the session through the vault, show the countdown silently.
  - If the window playing the sounds closes or reloads, the session keeps running silently and still ends on time.
  - A Stop from any window or computer silences the window that is playing, because the audio engine follows the state.
  - When a session ends naturally, the finishing sound is never cut off, even if a new session starts right away.
- **Engine:** there is one `FocusAudio` per open vault (`web/src/modules/focus/audio.ts`). It fetches the selected sounds ahead of time and decodes them on first use. The ticking loop fades in and out over 50 ms, so there are no clicks.
- **Concurrent starts:** if a Start meets a session that is still running (for example two computers both started), the newer Start wins and the older session counts as stopped at the newer Start's `at`. This follows the rejected-on-merge rules in §4.5.

### 10.2 `timetrack`: time tracker

A calendar of tracked **blocks**: time intervals with an optional title and any number of tags. Tags drive colours and statistics.

#### Time model: time zones are transparent

- **Blocks are absolute instants.** A block stores `startMs`/`endMs` as UTC epoch ms and nothing more. It does not store a time zone, because a block means "this span of real time", whichever computer recorded it.
- **Everything is shown in the current computer's local time zone.** If you travel, or open the vault on a computer set to another zone, the same blocks appear at the matching local wall-clock times. Totals per day are also computed in the current zone.
- **Logical day.** A calendar day runs from the configured **day start hour** to the same hour on the next day, in local time. For example, a block at 02:00 on 5 Nov belongs to the 4 Nov day. Totals per day, the month view and statistics all use logical days. A block that crosses a day boundary is split across the days it touches.
- **Day window.** The **visible** window of a day is from `startHour` to `endHour`, both whole local hours. The default is 07:00 to 05:00 the next day. If `endHour ≤ startHour`, the end falls on the next day. The window can be at most 24 h; that's the "cannot overlap" rule. Blocks outside the window still exist and count in totals, but the timeline simply clips them; it doesn't need to show them.
- **Daylight saving time.** A logical day is 23, 24 or 25 real hours long. The timeline is drawn in real elapsed time, so an hour label repeats or is skipped on those days. Do all calendar arithmetic (start of day/week/month, adding days, wall clock ↔ instant) through one `time/` helper built on `Temporal.ZonedDateTime`, with a polyfill where the browser lacks Temporal. Never do it with hand-written `Date` arithmetic.
- **The week starts on Monday,** defined as one constant (`WEEK_STARTS_ON = 1`).

#### Panels

| Panel | Contents |
| --- | --- |
| `timetrack.timeView` | Day/Week/Month toggle, ‹ › arrows, a clickable date label (opens a date picker popover for jumping to faraway dates), a **Today** button, the **Start/Stop tracking** button, and the calendar itself. |
| `timetrack.stats` | Statistics for the exact range currently shown (that day, week or month). |
| `timetrack.tags` | Tag management. |
| `timetrack.settings` | Day window start and end hours. |

Default layout of the Time tracking tab: `split(h, [timetrack.timeView, tabs[timetrack.stats, timetrack.tags, timetrack.settings]])`, with the time view taking most of the width. Panels talk to each other only through module state. The selected view and date range are **UI state** in a store shared by the module's panels. They are not commands, because navigating is not an undoable change.

#### Views

- **Day:** a vertical timeline from `startHour` to `endHour`.
  - Blocks are drawn in their tag's colour (see *Colours* below). A running block grows up to a "now" line.
  - Mouse-drag on empty space creates a block. Drags snap to 5 minutes and show a live preview, including any truncation that will result (see *Overlap rule* below).
  - Clicking a block opens the block pop-up. Dragging its top or bottom edge changes its start or end time (see *Resizing blocks* below).
- **Week:** the same timeline repeated as 7 day columns, Monday to Sunday, with the same drag, resize and click behaviour.
- **Month:** a calendar grid of logical days.
  - Each day shows its **total hours** and a **pie chart**. The pie's slices are the tags' shares of that day, and its size grows with the day's hours.
  - Size scaling: the pie's **area** is proportional to hours (radius ∝ √hours), on a fixed scale where 12 h fills the cell (clamped), so months can be compared. Days with nothing tracked show no pie.
  - There are no blocks in this view. Clicking a day opens that day in Day view.

#### Blocks

- **Fields:** `title` (optional) and `tagIds` (any number, may be empty). An empty title is stored as empty and *shown* as the catalog default, "Working". The default title is never written into the data, so it follows the language.
- **Two ways to create one:**
  - **Drag:** release the mouse to open the pop-up. **Save** issues one `tt.CreateBlock`; **Cancel** discards it.
  - **Start tracking:** the pop-up opens. **Save** issues `tt.StartTracking`, using the moment the button was pressed as the start, not the moment Save was clicked. The button then turns into **Stop tracking**, which issues `tt.StopTracking` with `end = now` and no pop-up.
- **At most one running block.** If two computers start tracking at the same time, the newer start ends the older running block at the newer start time (§4.5).
- **Block pop-up:**
  - Fields: a title input, and a scrollable list of all tags with a toggle for each.
  - Clicking an existing block in Day or Week view opens the same pop-up, with a **Delete** button added. **Save** issues one `tt.EditBlock` containing only the fields that changed.
  - One pop-up interaction is always one undo step.
- **Overlap rule: blocks never overlap.**
  - When a block is created, edited, or stopped, the **block that starts later** is truncated so that it starts where the earlier one ends.
  - If the later block ends up fully covered, it is removed.
  - Truncation is computed in the apply function, so it is deterministic on replay. Undoing the command that caused it restores the other block.
  - A running block ends at "now" for this rule; it is applied for real when the block is stopped.
  - Resizing never truncates other blocks; the drag is clamped instead (see below). The truncation rule stays in the apply function as a backstop for edits merged from other computers.

#### Resizing blocks

- **Edge handles:** in Day and Week view, every block has a grab zone about 6 px tall at its top and bottom edges, with an `ns-resize` cursor.
  - Dragging the top edge changes `startMs`; dragging the bottom edge changes `endMs`.
  - Drags snap to 5 minutes, like creating a block. A press that moves less than about 4 px counts as a click and opens the block pop-up.
  - An edge clipped by the visible day window has no handle.
- **Running block:** only the top edge can be dragged, which changes when tracking started. Its end is "now" and keeps growing. The start can't be dragged past "now".
- **Clamped by neighbours:** no overlap is ever shown or saved.
  - The top edge stops at the **end of the previous block**.
  - The bottom edge stops at the **start of the next block**.
  - An edge also stops at the block's own other edge (zero length). It never crosses it, so a block can't be turned inside out.
- **Live preview, one command:**
  - While dragging, only the preview moves.
  - Releasing at a non-zero length issues one `tt.EditBlock { blockId, startMs?, endMs? }`, so one drag is one undo step.
  - Releasing at the original time issues nothing.
  - **Esc** during a drag cancels it.
- **Zero length:** releasing a block at zero length opens a confirmation pop-up, "Delete this block?".
  - **Delete** issues `tt.DeleteBlock`. For a running block, this also ends the tracking without keeping any record.
  - **Cancel** puts the block back as it was and issues nothing.

#### Tags

- **Fields:** `name` (a free string, unique after trimming, case-insensitive), `color` (hex), `description` (optional free text). Tags have a stable internal `tagId`, so renaming one is cheap and every block follows the rename.
- **Tags panel:**
  - A scrollable list of tags, each with a colour swatch, name and description.
  - Add, rename, edit the description, change the colour, delete.
- **Deleting a tag** marks it as deleted (a tombstone) rather than erasing it. Blocks that carried it are then shown and counted as if they don't have it. Undoing the delete brings it back everywhere.
- **Colours:**
  - **Default colours** come from **RColorBrewer Dark2**: `#1B9E77 #D95F02 #7570B3 #E7298A #66A61E #E6AB02 #A6761D #666666`. A new tag gets the least-used of the first seven. The eighth, `#666666`, is grey and too close to the untagged colour, so it is only used if picked by hand.
  - **Overriding the colour:** a pop-up colour wheel (HSV) with the Dark2 swatches as one-click quick picks.
- **Tag colours are user data**, stored in the vault and the same for every theme. The **untagged** grey is a theme token, `--tag-none`. Text drawn on a block picks black or white for contrast against its colour.
- **A block with several tags** is drawn with equal vertical stripes, one per tag colour.

#### Statistics (`timetrack.stats`)

- **Total hours** in the current range.
- **Per-tag pie with legend** (hours and percentage per tag). The categories are the tags in use plus **No tag**. The pie appears only when the range has two or more categories.
- **Counting:** a block with *n* tags adds 1/*n* of its duration to each of those tags, so the slices always add up to the total.
- Month-view pies per day use the same rule. Draw pies as plain SVG; no chart library is needed.

#### Commands

| Command | Payload | Notes |
| --- | --- | --- |
| `tt.CreateBlock` | `{ blockId, startMs, endMs, title, tagIds }` | `deps` on the tags' `CreateTag` |
| `tt.StartTracking` | `{ blockId, startMs, title, tagIds }` | ends any other running block |
| `tt.StopTracking` | `{ blockId, endMs }` | `deps` on the Start; undoing it makes the block run again |
| `tt.EditBlock` | `{ blockId, title?, tagIds?, startMs?, endMs? }` | only changed fields; `startMs`/`endMs` come from resizing (`endMs` not allowed while running) |
| `tt.DeleteBlock` | `{ blockId }` | |
| `tt.CreateTag` | `{ tagId, name, color, description }` | |
| `tt.EditTag` | `{ tagId, name?, color?, description? }` | the colour wheel commits on close, not on every pointer move |
| `tt.DeleteTag` | `{ tagId }` | tombstone |
| `tt.SetDayWindow` | `{ startHour, endHour }` | validated: whole hours, window ≤ 24 h |

All of these are undoable through the Time tracking undo stack. Commands that target a block or tag removed by another writer are rejected-on-merge (§4.5).

#### State and performance

- Blocks are kept sorted by `startMs`, with an interval index for range queries. Totals per logical day, overall and per tag, are cached and invalidated by key when blocks change.
- Logical-day keys depend on the current time zone and day start hour. Those caches are rebuilt when either one changes, and they are not part of snapshots; snapshots hold only the time-zone-independent block and tag state.
- Rendering a month or week must not scan all of history.

---

## 11. Roadmap / TODO

- [x] Project scaffold: npm workspace, Vite + Svelte 5, Vitest, Playwright, build info in the footer, GitHub Pages workflow (`base: /FocusPocus/`)
- [x] Core: command envelope, runner, incremental apply, checkpoints, batches, per-module undo/redo, upcasters, rejected-on-merge
- [x] Vault: `StorageBackend` (FS Access + in-memory), live segments, write coalescing, loading and merging, polling, BroadcastChannel, compaction, read-only mode
- [ ] Vault: on-disk snapshots (`ModuleDefinition.snapshot`), load-time benchmark (§8), first frozen fixture vault
- [ ] Vault: surface rejected-on-merge commands to the user for review (today only a count in the status bar)
- [x] Vault picker: IndexedDB handle, permission re-request, create/open vault
- [x] Shell: layout tree host (nested tabs and splits), undo/redo bar plus keyboard shortcuts, toasts, status bar
- [x] Theme registry with **Dark** (default) only; no-hard-coded-colour test
- [x] i18n registry with **English** only; coverage spec
- [x] Placeholder panels for the time tracker, wired to its spec'd `tt.SetDayWindow` settings command
- [x] `focus` module (§10.1): commands, timer and settings panels, sound registry, audio engine, generated sound assets plus licences
- [ ] `timetrack` core (§10.2): time model (UTC instants, logical days, DST), block and tag commands, overlap truncation, range index, per-day aggregates
- [ ] `timetrack` time view: Day/Week/Month switch, navigation and date picker, day/week timeline with drag-to-create, running block, month grid with pies
- [ ] `timetrack` block pop-up (create/edit/delete), Start/Stop tracking
- [ ] `timetrack` block resizing: edge handles, neighbour clamping, running-block start, zero-length delete confirmation
- [ ] `timetrack` statistics panel: total plus per-tag pie
- [ ] `timetrack` tags panel: list, add/delete, rename, description, colour wheel with Dark2 quick picks
- [ ] `timetrack` settings panel: day window hours
- [ ] Shell: modal/pop-up and popover primitives
- Later: theme and language selection (`app.SetTheme`, `app.SetLanguage`), user-arranged layouts
