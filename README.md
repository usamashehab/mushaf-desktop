# Mushaf — مصحف

The Madinah Mushaf on your desktop, drawn exactly as the printed page, and opened by
your coding agent (Claude Code, Codex, …) while it works, so the wait goes to the Quran.
When the agent finishes, the app tells you.

> **Status: early development.** This repo holds the data and the shared logic so far;
> the desktop app (Tauri, for Windows, macOS and Linux) comes next. For a Mushaf in
> the terminal today, see [claude-quran](https://github.com/usamashehab/claude-quran).

## How the page stays exact

Every page is drawn with the King Fahd Complex **QCF V2** fonts: one font per page,
each glyph a whole word as the 1421H Madinah print draws it, placed on the line it
sits on in that print. Nothing is shaped or wrapped by the computer.

The fonts (93 MB) are downloaded once on first launch and kept offline after.

## Repo

```
packages/core/      platform-free logic: data types, go to ("2:255", "البقرة", "juz 3"), settings
packages/packs/     Mushaf packs: the manifest a style of Mushaf is described by
tools/build-data/   builds data/ from the Quran.com API and checks every page
data/               the built data, committed: quran-meta.json, packs/qcf-v2/{layout,manifest}.json
```

```sh
corepack enable
pnpm install
pnpm test
pnpm typecheck
pnpm build-data   # rebuild data/ (downloads ~95 MB into .cache/ the first time)
```

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
