/**
 * Visibility Auditor – Foundry VTT v12 through v14
 *
 * Scans all world documents and surfaces anything that is visible
 * to at least one non-GM user. Provides a searchable, filterable
 * audit table that Game Masters can open from sidebar directory
 * headers or via a macro-callable API.
 */

/* ──────────────────────────────────────────────────────────────
   CONSTANTS
   ────────────────────────────────────────────────────────────── */

const OWNERSHIP_LEVELS = [
  { value: 0, label: "None",          slug: "none" },
  { value: 1, label: "Limited",       slug: "limited" },
  { value: 2, label: "Observer",      slug: "observer" },
  { value: 3, label: "Owner",         slug: "owner" },
];

const COLLECTION_MAP = {
  Actor:        "actors",
  JournalEntry: "journal",
  Item:         "items",
  Scene:        "scenes",
};

const TEMPLATE_PATH = "modules/visibility-auditor/templates/audit-dialog.hbs";
const TAG = "visibility-auditor-dialog";

/* ──────────────────────────────────────────────────────────────
   HELPERS
   ────────────────────────────────────────────────────────────── */

/** Return a human-readable label for a numeric ownership level. */
function levelLabel(value) {
  const match = OWNERSHIP_LEVELS.find(l => l.value === value);
  return match ? match.label : "None";
}

function levelSlug(value) {
  const match = OWNERSHIP_LEVELS.find(l => l.value === value);
  return match ? match.slug : "none";
}

/**
 * Determine whether a document is visible to at least one non-GM
 * player, and build the row data for the audit table.
 *
 * @param {Document} doc
 * @param {User[]}   nonGmPlayers
 * @returns {Object|null}  Row object, or null when not shared.
 */
function buildRow(doc, nonGmPlayers) {
  const ownership = doc.ownership ?? {};
  const defaultLevel = ownership.default ?? 0;

  const sharedPlayers = [];

  for (const player of nonGmPlayers) {
    const lvl = ownership[player.id] ?? 0;
    if (lvl > 0) {
      sharedPlayers.push({
        name:      player.name,
        color:     player.color ?? "#888",
        level:     levelLabel(lvl),
        levelSlug: levelSlug(lvl),
      });
    }
  }

  const isShared = defaultLevel > 0 || sharedPlayers.length > 0;
  if (!isShared) return null;

  return {
    id:           doc.id,
    name:         doc.name ?? "(Unnamed)",
    defaultLevel: defaultLevel > 0 ? levelLabel(defaultLevel) : null,
    defaultSlug:  levelSlug(defaultLevel),
    players:      sharedPlayers,
    document:     doc,
  };
}

/* ──────────────────────────────────────────────────────────────
   APPLICATION
   ------------------------------------------------------------------
   The ApplicationV2 class layout differs between Foundry releases:
     - v12:  foundry.applications.api.HandlebarsApplicationV2 and the
             top-level `template` option.
     - v13+: HandlebarsApplicationMixin(ApplicationV2) and static
             `PARTS` (the `template` option renders nothing).
   A small factory builds the correct class for the running version.
   ────────────────────────────────────────────────────────────── */

function isV13OrLater() {
  return (game?.release?.generation ?? 0) >= 13;
}

function createVisibilityAuditorApp(AppBase, { usesParts }) {
  return class VisibilityAuditorApp extends AppBase {
    static DEFAULT_OPTIONS = {
      id:       TAG,
      title:    "Visibility Auditor",
      classes:  ["visibility-auditor-app"],
      position: { width: 820, height: 600 },
      resizable: true,
      window: {
        title:    "Visibility Auditor",
        resizable: true,
      },
      // v12 only – v13/v14 render through PARTS instead.
      ...(usesParts ? {} : { template: TEMPLATE_PATH }),
      actions: {
        openSheet: VisibilityAuditorApp._onOpenSheet,
      },
    };

    static PARTS = usesParts
      ? { audit: { root: true, template: TEMPLATE_PATH } }
      : undefined;

    constructor() {
      super({});
      this._searchTerm = "";
      this._typeFilter = "all";
    }

    /** Context data handed to the Handlebars template. */
    async _prepareContext() {
      const nonGmPlayers = game.users.filter(u => !u.isGM);
      const rows = [];

      for (const [typeLabel, collectionKey] of Object.entries(COLLECTION_MAP)) {
        const collection = game.collections.get(collectionKey);
        if (!collection) continue;

        for (const doc of collection.contents) {
          const row = buildRow(doc, nonGmPlayers);
          if (row) {
            row.type = typeLabel;
            rows.push(row);
          }
        }
      }

      // Sort by type, then name
      rows.sort((a, b) => {
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        return a.name.localeCompare(b.name);
      });

      return { rows };
    }

    /** After render – bind the live filter controls. */
    async _onRender(context, options) {
      await super._onRender(context, options);

      const searchEl = this.element.querySelector(".va-search");
      const typeEl   = this.element.querySelector(".va-type-filter");

      if (searchEl) {
        searchEl.value = this._searchTerm;
        searchEl.addEventListener("input", (e) => {
          this._searchTerm = e.target.value;
          this._applyClientFilters();
        });
      }

      if (typeEl) {
        typeEl.value = this._typeFilter;
        typeEl.addEventListener("change", (e) => {
          this._typeFilter = e.target.value;
          this._applyClientFilters();
        });
      }
    }

    /** Client-side row filtering (no re-render needed). */
    _applyClientFilters() {
      const tbody = this.element.querySelector(".va-table tbody");
      if (!tbody) return;

      const term = this._searchTerm.toLowerCase();
      const type = this._typeFilter;

      for (const row of tbody.querySelectorAll(".va-row")) {
        const name    = row.querySelector(".va-cell-name")?.textContent?.toLowerCase() ?? "";
        const rowType = row.querySelector(".va-cell-type")?.textContent?.trim() ?? "";

        const matchesSearch = !term || name.includes(term);
        const matchesType   = type === "all" || rowType === type;

        row.style.display = (matchesSearch && matchesType) ? "" : "none";
      }
    }

    /** Action: open the sheet of the clicked document. */
    static async _onOpenSheet(event, target) {
      const docId = target.dataset.docId;
      if (!docId) return;

      for (const collectionKey of Object.values(COLLECTION_MAP)) {
        const collection = game.collections.get(collectionKey);
        if (!collection) continue;

        const doc = collection.get(docId);
        if (doc) {
          doc.sheet?.render(true);
          return;
        }
      }
    }
  };
}

// Build the application class for the running Foundry version.
let VisibilityAuditorApp;
if (isV13OrLater() && foundry.applications?.api?.HandlebarsApplicationMixin) {
  const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
  VisibilityAuditorApp = createVisibilityAuditorApp(
    HandlebarsApplicationMixin(ApplicationV2),
    { usesParts: true },
  );
} else if (foundry.applications?.api?.HandlebarsApplicationV2) {
  VisibilityAuditorApp = createVisibilityAuditorApp(
    foundry.applications.api.HandlebarsApplicationV2,
    { usesParts: false },
  );
} else {
  throw new Error("Visibility Auditor | No compatible ApplicationV2 base class found.");
}

/* ──────────────────────────────────────────────────────────────
   OPEN DIALOG
   ────────────────────────────────────────────────────────────── */

let _dialog = null;

function openAuditDialog() {
  if (!game.user.isGM) return;
  if (!_dialog) _dialog = new VisibilityAuditorApp();
  _dialog.render(true);
}

/* ──────────────────────────────────────────────────────────────
   SIDEBAR BUTTON – Foundry v13.332+ / v14
   ------------------------------------------------------------------
   Sidebar tabs are ApplicationV2 apps which no longer fire the
   legacy `renderSidebarTab` hook. Use the official header-control
   hooks instead, and additionally bind a direct click listener on
   the rendered control via the per-class render hook.
   ────────────────────────────────────────────────────────────── */

const AUDIT_DIRECTORY_CLASSES = [
  "ActorDirectory",
  "JournalDirectory",
  "ItemDirectory",
  "SceneDirectory",
];

function addAuditHeaderControl(app, controls) {
  if (!game.user.isGM) return;

  if (!controls.some(c => c.class === "va-audit-control")) {
    controls.push({
      class: "va-audit-control",
      icon:  "fas fa-user-shield",
      label: "Audit Permissions",
      title: "Audit Permissions",
      action: "visibilityAuditDialog",
    });
  }

  // Belt-and-braces: make the action resolvable on the app instance,
  // in case the direct DOM binding below does not run.
  const actions = app.options?.actions ?? (app.options.actions = {});
  actions.visibilityAuditDialog = () => openAuditDialog();
}

function bindAuditControl(element) {
  if (!game.user.isGM) return;
  const root = element instanceof HTMLElement ? element : undefined;
  if (!root) return;

  const control = root.querySelector(".va-audit-control");
  if (!control || control.dataset.vaBound) return;

  control.dataset.vaBound = "1";
  control.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    openAuditDialog();
  });
}

/* ──────────────────────────────────────────────────────────────
   SIDEBAR BUTTON – Foundry v12 / early v13
   ------------------------------------------------------------------
   Legacy sidebar directories still render a `.directory-header`
   and fire `renderSidebarTab`; append a plain header button there.
   ────────────────────────────────────────────────────────────── */

const AUDIT_TAB_NAMES = ["actors", "journal", "items", "scenes"];

function addAuditButton(app, html) {
  if (!game.user.isGM) return;

  if (!AUDIT_TAB_NAMES.includes(app.tabName)) return;

  const header = (html[0]?.querySelector?.(".directory-header"))
    ?? html.querySelector?.(".directory-header");
  if (!header || header.querySelector(".va-audit-btn")) return;

  const button = document.createElement("button");
  button.className = "va-audit-btn";
  button.title = "Audit Permissions";
  button.innerHTML = '<i class="fas fa-user-shield"></i>';
  button.addEventListener("click", () => openAuditDialog());
  header.appendChild(button);
}

/* ──────────────────────────────────────────────────────────────
   INITIALISATION
   ────────────────────────────────────────────────────────────── */

Hooks.once("ready", () => {
  // Expose the macro-callable API for every user; every entry point
  // internally enforces the Game Master-only restriction.
  const mod = game.modules.get("visibility-auditor");
  if (mod) {
    mod.api = { openDialog: openAuditDialog };
    console.log("Visibility Auditor | Module ready – API available at game.modules.get('visibility-auditor').api.openDialog()");
  }
});

// Register the appropriate directory button mechanism for this version.
const release = game?.release ?? {};
const usesHeaderControlHooks =
  release.generation >= 14
  || (release.generation >= 13 && (Number.parseInt(`${release.build ?? 0}`, 10) >= 332));

if (usesHeaderControlHooks) {
  for (const cls of AUDIT_DIRECTORY_CLASSES) {
    Hooks.on(`getHeaderControls${cls}`, addAuditHeaderControl);
    Hooks.on(`render${cls}`, (app, element) => bindAuditControl(element));
  }
} else {
  Hooks.on("renderSidebarTab", addAuditButton);
}