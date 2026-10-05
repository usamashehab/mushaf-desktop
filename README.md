# Mushaf — مصحف

The Madinah Mushaf on your desktop, drawn exactly as the printed page, and opened by
your coding agent (Claude Code, Codex, …) while it works, so the wait goes to the Quran.
When the agent finishes, the app tells you.

> **Status: early development.** The desktop app (Tauri) runs on Linux today; Windows
> and macOS builds come from the same code. For a Mushaf in the terminal, see
> [claude-quran](https://github.com/usamashehab/claude-quran).

## With your coding agent

The app connects to **Claude Code** and **Codex** through their hooks. Connect them in
the app (Settings ⚙ → Coding agents) or from a terminal:

```sh
mushaf integrations install          # every agent found; or: install claude / install codex
mushaf integrations                  # what is connected
mushaf integrations uninstall codex  # takes out only the Mushaf's hooks
```

Then:

- **While the agent works**: a task still running after 2 minutes (change it per agent
  in Settings) opens the Mushaf in front of you, once per task. A shorter task opens nothing.
- **When it finishes, or stops to ask you something**: a banner inside the Mushaf says
  so, e.g. "Claude finished — shop-api". A system notification, a chime, and alerts
  while the Mushaf is closed are options in Settings, off by default.
- Closing the window keeps the Mushaf in the tray, so it can open again; Quit is in the
  tray menu, with "Pause alerts until tomorrow". If it isn't running, the next task starts it there.

**Codex asks once** to trust new hooks: start `codex` after connecting it and choose
"Trust all and continue". Until then Codex skips them silently.

Installing edits `~/.claude/settings.json` or `~/.codex/hooks.json` in place: every hook
you already have stays, a copy of the file is kept first (`*.mushaf.bak`), and running it
twice changes nothing. The hooks pass on only the agent, its session id, what happened and
the project folder's name; prompts and messages never leave them.

Other commands: `mushaf open 2:255` (a page, an ayah or a surah name), `mushaf status`
(the agents at work, and what the app last heard from each). Any other agent can call
`mushaf hook <name> started|finished|attention|ended` from its own hooks.

## How the page stays exact

Every page is drawn with the King Fahd Complex **QCF V2** fonts: one font per page,
each glyph a whole word as the 1421H Madinah print draws it, placed on the line it
sits on in that print. Nothing is shaped or wrapped by the computer.

The fonts (93 MB) are downloaded once on first launch and kept offline after.

## Repo

```
apps/desktop/       the app: the reader in a Tauri shell (src-tauri/: fonts, settings, agents, tray)
packages/core/      platform-free logic: data types, go to ("2:255", "البقرة", "juz 3"), settings
packages/packs/     Mushaf packs: the manifest a style of Mushaf is described by
packages/reader/    the reader: React components that draw exact pages, no platform code
crates/             mushaf-protocol (hook payloads → events), mushaf-ipc (the local socket),
                    mushaf-agents (installs hooks), mushaf-cli (the `mushaf` command)
tools/build-data/   builds data/ from the Quran.com API and checks every page
tests/visual/       every page in Chromium and WebKit: screenshots, and no line overflowing
data/               the built data, committed: quran-meta.json, packs/qcf-v2/{layout,manifest}.json
```

```sh
corepack enable
pnpm install
pnpm test
pnpm typecheck
pnpm build-data   # rebuild data/ (downloads ~95 MB into .cache/ the first time)
pnpm dev          # the reader at http://127.0.0.1:5173 (needs build-data's fonts in .cache/;
                  # add ?agents=demo for the agents' banner, chip and settings)
cargo test --workspace
pnpm --dir apps/desktop exec tauri build   # the app and its installers, with `mushaf` beside it
pnpm test:visual  # screenshots and overflow checks (first: pnpm exec playwright install chromium webkit)
```

Reader keys: ← next page, → previous (a Mushaf turns leftward), PgDn/PgUp, Home/End,
Ctrl+K or / to search and go to, + and − to zoom, 0 to reset, D for the theme,
B to bookmark, M for the bookmarks, I for the index.

The build fails without writing anything when the data doesn't add up: 604 pages,
6236 ayahs in reading order, every glyph code present in its page font, no line
wider than the page. Known mistakes in the source data are put right in
[`tools/build-data/src/patches.json`](tools/build-data/src/patches.json), each with
the reason.

## Credits

- Text, glyph codes and line layout: [Quran.com API](https://api-docs.quran.foundation) (Quran Foundation).
- Fonts: [King Fahd Glorious Quran Printing Complex](https://qurancomplex.gov.sa) (KFGQPC),
  free to use and distribute, not to modify or sell.
- Basmala font: KFGQPC, via [nuqayah/qpc-fonts](https://github.com/nuqayah/qpc-fonts).

## License

The code is MIT ([LICENSE](LICENSE)). The Quran text and the fonts keep their own terms above.
