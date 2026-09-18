# Visibility Auditor

![Foundry VTT](https://img.shields.io/badge/Foundry_VTT-v12_through_v14-blue)
![License](https://img.shields.io/badge/License-MIT-green)

**Visibility Auditor** is a Foundry Virtual Tabletop module for Game Masters that surfaces every world document (Actors, Journal Entries, Items, and Scenes) currently visible or shared with non-GM players — before an accidental spoiler ruins the session.

## What it does

During live play, GMs frequently grant document permissions to individual players or "All Players" (e.g. to reveal handouts, NPCs, or upcoming scenes). It's easy to forget to revoke those permissions afterwards. Visibility Auditor gives you a single searchable, filterable table of every document your players can currently see, so nothing slips through during prep or mid-session — for example, a future-scene handout or a boss stat block still left on "Observer."

For each shared document the table shows:

- **Type** — Actor, Journal, Item, or Scene
- **Name** — clickable, opens the document's sheet
- **Default (All Players)** — permission level granted globally to every player, or `—`
- **Specific Players** — a colored pill per player with an individual permission override

Permission levels are color-coded: <span style="color:#4ade80"><b>Owner</b></span> (green), <span style="color:#60a5fa"><b>Observer</b></span> (blue), and <span style="color:#fbbf24"><b>Limited</b></span> (yellow).

## Features

- 🔍 **Live search** — type to filter rows by document name instantly
- 🗂 **Type filter** — narrow the table to All, Actors, Journal Entries, Items, or Scenes
- 📄 **Click-to-open** — click any document name to open its sheet and fix permissions
- 🧑‍🤝‍🧑 **Per-player detail** — player-colored pills show exactly who has what level
- 🖱 **Sidebar access** — a shield button in the Actor, Journal, Item, and Scene directory headers
- ⚙️ **Macro-friendly** — fully scriptable via the module API

## Compatibility

- Foundry VTT **v12** (minimum) through **v14** (verified)
- System-agnostic — works with any game system

## Installation

### Method 1 — Module Manager (recommended)

1. In Foundry VTT, open **Add-on Modules** → **Install Module**.
2. Enter the `manifest` URL from the latest release on the [Releases](https://github.com/your-username/visibility-auditor/releases) page.
3. Click **Install**, then enable **Visibility Auditor** in your world's Module Management.
4. Refresh the world — a shield icon appears in your sidebar directory headers.

### Method 2 — Manual install

1. Clone or download this repository.
2. Place the `visibility-auditor` folder into your world data's `modules/` directory:
   ```
   <FoundryVTT Data>/Data/modules/visibility-auditor/
   ```
3. Enable the module in **Game Settings → Manage Modules**.
4. Refresh the world.

## Usage

### From the sidebar
Click the **shield icon** (`🛡`) in the header of any supported directory (Actors, Journal Entries, Items, Scenes) to open the audit dialog.

### From a macro
```js
game.modules.get("visibility-auditor").api.openDialog();
```

The dialog lists every document visible to at least one non-GM user. Use the search box to filter by name, use the dropdown to filter by type, and click any document name to open its sheet and adjust permissions.

If no documents are visible to players, a friendly "all clear" message is shown instead.

## Permissions model used

A document is flagged as **shared** when any of the following is true:

1. Its **default ownership** is greater than `None` (i.e. visible to "All Players"), or
2. Any **non-GM user** has an individual ownership override greater than `None`.

Ownership levels follow Foundry's `CONST.DOCUMENT_OWNERSHIP_LEVELS`:

| Value | Level |
|-------|-------|
| 0 | None |
| 1 | Limited |
| 2 | Observer |
| 3 | Owner |

Only Game Masters can open or interact with the auditor; the button and API are hidden from players.

## Project structure

```
visibility-auditor/
├── module.json              # Module manifest
├── scripts/
│   └── auditor.js           # App class, hooks, and API
├── styles/
│   └── auditor.css          # Scoped dark-theme styling
└── templates/
    └── audit-dialog.hbs     # Handlebars template
```

## License

[MIT](LICENSE) — free to use, modify, and redistribute, for any purpose, commercial or otherwise. See the [LICENSE](LICENSE) file for the full text.