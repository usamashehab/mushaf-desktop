# Mushaf — مصحف

The Madinah Mushaf on your desktop, drawn exactly as the printed page, and opened by
your coding agent (Claude Code, Codex, Cursor, OpenCode, Antigravity, DeepSeek TUI) while
it works, so the wait goes to the Quran.
When the agent finishes, or stops to ask you something, the Mushaf tells you.

- [Install](#install)
- [Connect your coding agent](#connect-your-coding-agent)
- [Settings](#settings)
- [Using the Mushaf](#using-the-mushaf)
- [The `mushaf` command](#the-mushaf-command)
- [Troubleshooting](#troubleshooting)
- [Uninstall](#uninstall)
- [For AI assistants](#for-ai-assistants)
- [Development](#development)

> **Status: early development (0.2.0).** Tested by hand on Linux (Ubuntu, GNOME, X11).
> The Windows and macOS installers are built from the same code but not yet tested by hand.
> For a Mushaf inside the Claude Code terminal, see
> [claude-quran](https://github.com/usamashehab/claude-quran).

## Install

1. Download the file for your computer from the
   **[latest release](https://github.com/usamashehab/mushaf-desktop/releases/latest)**:

   | Computer | File |
   | --- | --- |
   | Linux: Ubuntu, Debian, Mint | `Mushaf_0.2.0_amd64.deb` |
   | Linux: Fedora, openSUSE | `Mushaf-0.2.0-1.x86_64.rpm` |
   | Windows 10 or 11 | `Mushaf_0.2.0_x64-setup.exe` |
   | Mac with Apple silicon (M1 or later) | `Mushaf_0.2.0_aarch64.dmg` |

2. Install it:

   - **Ubuntu, Debian:** double-click the file, or in a terminal, in the folder you saved it to:
     `sudo apt install ./Mushaf_0.2.0_amd64.deb`
   - **Fedora:** `sudo dnf install ./Mushaf-0.2.0-1.x86_64.rpm`
   - **Windows:** run the file. The installer isn't signed, so Windows may show
     "Windows protected your PC": choose **More info**, then **Run anyway**.
   - **Mac:** open the `.dmg` and drag **Mushaf** to Applications. The app isn't notarized
     by Apple, so the first time, run this in Terminal before opening it:
     `xattr -cr /Applications/Mushaf.app`

3. Open **Mushaf**. The first time, it downloads the page fonts (about 95 MB) once;
   after that it works offline.

4. Connect your coding agent: see the next section.

**Updating:** install the new file over the old one, the same way. Your settings,
bookmarks and connected agents stay. To connect an agent the new version adds, turn it on
in Settings or run `mushaf integrations install`.

## Connect your coding agent

The Mushaf hears from your coding agents through their hooks. Connect them once, in
either of two ways:

- **In the app:** open Settings (the sliders button at the end of the top bar: the far left
  in Arabic, the far right in English), then under
  **Coding agents** turn on the switch next to each agent.
- **From a terminal:**

  ```sh
  mushaf integrations install          # every agent found on this computer
  mushaf integrations install claude   # or one: claude, codex, cursor, opencode, agy, deepseek
  mushaf integrations                  # check: each connected agent says "on"
  ```

**Codex needs one more step.** Codex runs new hooks only after you trust them: start
`codex` in a terminal and choose **Trust all and continue** when it says
"Hooks need review". Until then, Codex skips them without a word.

**OpenCode and DeepSeek TUI read their hooks when they start:** restart any session that
was already open. Claude Code, Cursor and Antigravity pick the hooks up by themselves.

What connecting changes, per agent:

| Agent | `install` id | File | What the Mushaf hears |
| --- | --- | --- | --- |
| Claude Code | `claude` | `~/.claude/settings.json` | starts, finishes, waits for you, Esc |
| Codex | `codex` | `~/.codex/hooks.json` | starts, finishes, waits for you, Esc |
| Cursor | `cursor` | `~/.cursor/hooks.json` | starts, finishes, stopped |
| OpenCode | `opencode` | `~/.config/opencode/plugin/mushaf.js` (a plugin file of its own) | starts, finishes, waits for you, Esc |
| Antigravity CLI (`agy`) | `agy` | `~/.gemini/config/hooks.json`, under the name `mushaf` | starts, finishes, Esc |
| DeepSeek TUI (`codewhale`) | `deepseek` | `~/.codewhale/config.toml` (or `~/.deepseek/config.toml`) | starts, finishes, waits for you, Esc |

Every hook you already have stays as it was. Before the first change, a copy of the file
is saved beside it (for example `settings.json.mushaf.bak`), and connecting twice changes
nothing. Cursor and Antigravity have no hook for a permission prompt, so the Mushaf can't
tell you when they wait for one. Cursor's connection follows Cursor's own hook format but
hasn't yet been tried with a signed-in Cursor; the others were tried with real tasks.

### What happens then

- **While the agent works:** when one task (one prompt) has run for 2 minutes, the Mushaf
  opens, once per task: in front of you, unless you chose behind or a notification in
  Settings. A shorter task opens nothing. A chip in the top bar shows who is working and for
  how long.
- **It waits until you're waiting.** The Mushaf doesn't come up while you type or use the
  mouse, for example in another agent: it opens once you've left the keyboard and mouse
  for 30 seconds. When an agent asks you something (a permission, a question), it also
  waits until you next touch the keyboard or mouse, to answer it. After you put away a
  Mushaf that opened by itself, it stays away for 10 minutes. With several agents at work,
  that makes one opening, not one each. The idle time comes from GNOME or KDE on Linux and
  from the system on Windows and macOS; on other Linux desktops the Mushaf opens on time.
- **When the agent finishes:** a banner inside the Mushaf: "Claude finished", with the
  project's name and how long it worked. It goes away after 2 minutes, or with its ✕.
- **When the agent stops to ask you something** (a permission, a question): a banner says
  it is waiting for you.
- **When you stop a task yourself** (Esc or Ctrl+C), the Mushaf doesn't open for it.
- **Closing the window** keeps the Mushaf in the system tray, so it can open again.
  To quit, use **Quit** in the tray menu. If it isn't running, the next task starts it in
  the tray.

### Privacy

The hooks pass the app only the agent's name, its session id, what happened, the
project folder's name, and, for Claude Code, Codex and Antigravity, where the session's
transcript or log file is. Prompts and replies never leave the hook. Those three agents
have no hook for a task you stop with Esc, so the app reads the file's last lines (at
most 64 KB) to notice one. Nothing leaves your computer: the app and the hooks talk over
a local socket only you can open.

## Settings

Open Settings with the sliders button at the end of the top bar, or by clicking the agent chip.

| Setting | Default | What it does |
| --- | --- | --- |
| Language | العربية | The interface language: Arabic or English |
| *Agent* switch | off | Connects or disconnects that agent's hooks (see above) |
| Open the Mushaf after | 2 minutes | Per agent: how long one task runs before the Mushaf opens. Never, 1, 2, 3, 5, 10, 15 or 30 minutes |
| When it is time for the Mushaf | Open in front | **Open behind** shows it behind the window you use; **Notify only** leaves it in the tray and sends a notification |
| Only when I'm away from the keyboard | on | Off: it opens on time even while you type |
| A soft chime with each alert | off | |
| A system notification too | off | A desktop notification along with the banner, when the Mushaf isn't the window in front. Alerts a few seconds apart share one notification and one chime |
| Alert me even when the Mushaf is closed | off | A desktop notification when an agent finishes while the Mushaf is in the tray |
| Pause until tomorrow | — | No opening and no alerts until midnight. Also in the tray menu. **Resume** undoes it |

Settings are saved in `~/.config/app.mushaf.desktop/settings.json` on Linux.

## Using the Mushaf

The pages sit in an open book: going to the next or the previous page turns the leaf
over, as a Mushaf turns; jumping further shows the new place at once, and with reduced
motion set on your computer the pages change without turning. Click an ayah for its menu
(bookmark, copy). Type in the search box to search the
Quran's text, or to go somewhere: `50` (a page), `2:255` (an ayah), `البقرة` or
`Al-Baqarah` (a surah).

| Key | Does |
| --- | --- |
| ← / Page Down / Space | Next page (a Mushaf turns leftward) |
| → / Page Up | Previous page |
| Home / End | First / last page |
| Ctrl+K, Ctrl+F, Ctrl+G or / | Search and go to |
| + / − / 0 | Zoom in / out / reset |
| D | Day, paper and night themes |
| B | Bookmark this place |
| M | The bookmarks |
| I | The index of surahs and juz |
| Esc | Close the panel or menu |

## The `mushaf` command

On Linux it is installed as `/usr/bin/mushaf`. On a Mac it is
`/Applications/Mushaf.app/Contents/MacOS/mushaf`, and on Windows `mushaf.exe` in the folder
Mushaf is installed in. Neither is on your `PATH`; the app's Settings do the same as
`mushaf integrations`.

| Command | Does |
| --- | --- |
| `mushaf open [place]` | Shows the Mushaf, starting it if needed. `place` is a page (`50`), an ayah (`2:255`) or a surah name (`البقرة`) |
| `mushaf status` | Whether the app runs, what it last heard from each agent, and the tasks at work |
| `mushaf integrations` | Each agent: `on`, `off`, `not installed on this machine`, or `on, but out of date` |
| `mushaf integrations install [agent]` | Connects `claude`, `codex`, `cursor`, `opencode`, `agy`, `deepseek`, or every agent found |
| `mushaf integrations uninstall [agent]` | Takes out only the Mushaf's hooks |
| `mushaf hook <agent> [started\|finished\|attention\|ended]` | What the hooks run. Reads the hook's JSON on stdin and always exits 0 |

Any other agent with hooks can use the last one. It names its event on the command line;
`session_id` and `cwd` are read from stdin when given:

```sh
echo '{"session_id": "abc", "cwd": "/home/me/shop-api"}' | mushaf hook aider started
echo '{"session_id": "abc", "cwd": "/home/me/shop-api"}' | mushaf hook aider finished
```

## Troubleshooting

Start with `mushaf status`. It prints a line per agent like
`Last heard from Codex: finished on shop-api, 3s ago.`

| Problem | Fix |
| --- | --- |
| No "Last heard from Codex" line after a Codex task | The hooks aren't trusted yet: start `codex` and choose **Trust all and continue** |
| No "Last heard from Claude" line after a Claude task | Run `mushaf integrations`; if Claude Code isn't `on`, run `mushaf integrations install claude` |
| `mushaf integrations` says `on, but out of date` | Run `mushaf integrations install`. For Codex, trust the changed hooks again |
| `mushaf integrations` says a file `is not valid JSON` (or `TOML`) | That agent's settings file has a mistake in it; fix it, then install again. The Mushaf never rewrites a file it can't read |
| No "Last heard from OpenCode" (or DeepSeek) line | The agent was open before you connected it: restart it |
| OpenCode: `mushaf.js is not the Mushaf's` | A plugin of yours has that name: rename it, then install again |
| The agent has worked past its minutes, but the Mushaf hasn't opened | It waits until you've left the keyboard and mouse for 30 seconds, until you answer an agent's question, and for 10 minutes after you put it away (see [What happens then](#what-happens-then)). `mushaf status` then says `ready: the Mushaf opens once you are not busy`. To open on time while you type, turn off **Only when I'm away from the keyboard** |
| `The Mushaf app is not running.` | Open **Mushaf**, or run `mushaf open` |
| No tray icon (GNOME) | Turn on the **AppIndicator** extension (Ubuntu has it on by default). Without a tray, closing the window quits the app; the next task starts it again |
| First launch stops at "تعذّر التحميل" (the download failed) | The fonts download needs an internet connection that one time: connect, then try again |

## Uninstall

First turn off each agent in Settings (or run `mushaf integrations uninstall`), so your
agents don't keep calling a program that's gone. Then:

- **Ubuntu, Debian:** `sudo apt remove mushaf`
- **Fedora:** `sudo dnf remove mushaf`
- **Windows:** Settings → Apps → Mushaf → Uninstall
- **Mac:** drag Mushaf from Applications to the Bin

This leaves your settings, bookmarks and the downloaded fonts. On Linux, to remove those
too: `rm -rf ~/.config/app.mushaf.desktop ~/.local/share/app.mushaf.desktop ~/.mushaf`.

## For AI assistants

These steps are for an AI coding assistant that a user has asked to install or configure
the Mushaf. Run each step's check before going on, and stop to tell the user when a
check fails.

**Rules**

- Never edit an agent's hook file yourself (`~/.claude/settings.json`,
  `~/.codex/hooks.json`, `~/.cursor/hooks.json`, `~/.gemini/config/hooks.json`,
  `~/.codewhale/config.toml`). Use `mushaf integrations install` / `uninstall`: they keep
  the user's own hooks and back the file up first.
- Never write Codex's hook trust yourself. Trusting hooks is the user's decision: ask them
  to do it (step 4).
- `sudo` needs the user's password. Ask the user to run that command, or in Claude Code
  to type it with a `!` in front.

**Steps (Linux, Debian or Ubuntu)**

On Windows or a Mac, have the user follow [Install](#install) instead, then connect the
agents in the app's Settings; the `mushaf` command isn't on the `PATH` there.

1. Check what is there already:
   `command -v mushaf mushaf-desktop; mushaf integrations`.
   If `mushaf` exists and the agents say `on`, go to step 5.
2. Download the latest `.deb`:

   ```sh
   url=$(curl -s https://api.github.com/repos/usamashehab/mushaf-desktop/releases/latest \
     | grep -o 'https://[^"]*_amd64\.deb' | head -1)
   curl -L -o /tmp/mushaf.deb "$url"
   ```

   Check: `dpkg-deb -f /tmp/mushaf.deb Package` prints `mushaf`.
3. Install it (the user runs it, since it needs `sudo`): `sudo apt install /tmp/mushaf.deb`.
   Check: `command -v mushaf` prints `/usr/bin/mushaf`.
4. Connect the agents: `mushaf integrations install`. Check: `mushaf integrations` shows
   `on` for each agent the user has. If Codex is connected, tell the user to start `codex`
   once and choose **Trust all and continue**. If OpenCode or DeepSeek TUI is connected,
   tell the user to restart any session of it that is open.
5. Open the app once so it downloads its fonts: `mushaf open`. Check: `mushaf status`
   prints `The Mushaf app 0.2.0 is running.`
6. Verify the connection with a short task in each agent (for example, ask it to reply
   "ok"), then run `mushaf status`. It must show `Last heard from Claude: ...` (or the
   agent's name) from a few seconds ago.

**Changing settings for the user**

Prefer telling the user where the setting is in the app ([Settings](#settings)). If you
must change the file, quit the app first (tray menu → Quit, or
`pkill -x mushaf-desktop`), since the running app writes its own copy over it. In
`~/.config/app.mushaf.desktop/settings.json`:

```json
{
  "agentDefaults": { "enabled": true, "openAfterMinutes": 2 },
  "agents": { "codex": { "enabled": true, "openAfterMinutes": 5 } },
  "alerts": { "openStyle": "front", "onlyWhenIdle": true, "notify": false, "notifyWhenClosed": false, "sound": false },
  "language": "ar"
}
```

`openAfterMinutes` is 0 for never. An agent missing from `agents` uses `agentDefaults`.
`openStyle` is `front`, `behind` or `notify`.
Change only the keys you need; leave the others as they are.

## How the page stays exact

Every page is drawn with the King Fahd Complex **QCF V2** fonts: one font per page,
each glyph a whole word as the 1421H Madinah print draws it, placed on the line it
sits on in that print. Nothing is shaped or wrapped by the computer.

## Development

### Build the installer yourself

On Linux, with [Rust](https://rustup.rs), Node.js 22 or newer, and the system libraries
[Tauri needs](https://v2.tauri.app/start/prerequisites/#linux):

```sh
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev \
  libssl-dev libayatana-appindicator3-dev librsvg2-dev
git clone https://github.com/usamashehab/mushaf-desktop.git
cd mushaf-desktop
corepack enable    # turns on pnpm, the package manager this repo uses
pnpm install
pnpm --dir apps/desktop exec tauri build --bundles deb
sudo apt install ./target/release/bundle/deb/Mushaf_0.2.0_amd64.deb
```

On Windows and macOS, follow Tauri's [prerequisites](https://v2.tauri.app/start/prerequisites/)
and run `cargo build --release -p mushaf-cli` before `pnpm --dir apps/desktop exec tauri build`.
Pushing a `v*` tag builds all the installers on GitHub (`.github/workflows/release.yml`).

### Work on the code

```
apps/desktop/       the app: the reader in a Tauri shell (src-tauri/: fonts, settings, agents, tray)
packages/core/      platform-free logic: data types, go to ("2:255", "البقرة", "juz 3"), settings
packages/packs/     Mushaf packs: the manifest a style of Mushaf is described by
packages/reader/    the reader: React components that draw exact pages, no platform code
crates/             mushaf-protocol (hook payloads → events), mushaf-ipc (the local socket),
                    mushaf-agents (installs hooks), mushaf-cli (the `mushaf` command)
tools/build-data/   builds data/ from the Quran.com API and checks every page
tests/visual/       every page in Chromium and WebKit: screenshots, and no line overflowing
data/               the built data, committed: quran-meta.json, search-text.json, packs/qcf-v2/
```

```sh
corepack enable
pnpm install
pnpm test
pnpm typecheck
cargo test --workspace
pnpm build-data                         # rebuild data/ (downloads ~95 MB into .cache/ the first time)
pnpm dev                                # the reader in a browser at http://127.0.0.1:5173
                                        # (needs build-data's fonts in .cache/; add ?agents=demo
                                        # for the agents' banner, chip and settings)
pnpm --dir apps/desktop exec tauri dev  # the desktop app, reloading as you edit
pnpm test:visual                        # screenshots and overflow checks
                                        # (first: pnpm exec playwright install chromium webkit)
```

The data build fails without writing anything when the data doesn't add up: 604 pages,
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
