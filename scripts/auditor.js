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
   ------------------------------------------------------------------
   NOTE: nothing at module top-level may touch `game`, `ui` or the
   `foundry.applications` namespaces – those are not guaranteed to be
   populated yet when an ES module is first evaluated in v14. All
   version detection and Application construction is deferred to
   runtime (see getAuditAppClass()).
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

/** Gather + sort every document shared with at least one non-GM user. */
function collectRows() {
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

  rows.sort((a, b) => {
    if (a.type !== b.type) return a.type.localeCompare(b.type);
    return a.name.localeCompare(b.name);
  });

  return rows;
}

/** Open the sheet for a document referenced by one of the audit rows. */
function openDocumentSheet(docId) {
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

/** Client-side row filtering shared by both Application versions. */
function applyClientFilters(element, searchTerm, typeFilter) {
  const tbody = element?.querySelector(".va-table tbody");
  if (!tbody) return;

  const term = searchTerm.toLowerCase();

  for (const row of tbody.querySelectorAll(".va-row")) {
    const name    = row.querySelector(".va-cell-name")?.textContent?.toLowerCase() ?? "";
    const rowType = row.querySelector(".va-cell-type")?.textContent?.trim() ?? "";

    const matchesSearch = !term || name.includes(term);
    const matchesType   = typeFilter === "all" || rowType === typeFilter;

    row.style.display = (matchesSearch && matchesType) ? "" : "none";
  }
}

/** Bind the toolbar filter controls on the given app element. */
function bindFilterControls(element, state) {
  const searchEl = element?.querySelector(".va-search");
  const typeEl   = element?.querySelector(".va-type-filter");

  if (searchEl) {
    searchEl.value = state.searchTerm;
    searchEl.addEventListener("input", (e) => {
      state.searchTerm = e.target.value;
      applyClientFilters(element, state.searchTerm, state.typeFilter);
    });
  }

  if (typeEl) {
    typeEl.value = state.typeFilter;
    typeEl.addEventListener("change", (e) => {
      state.typeFilter = e.target.value;
      applyClientFilters(element, state.searchTerm, state.typeFilter);
    });
  }
}

/* ──────────────────────────────────────────────────────────────
   APPLICATION – ApplicationV2 (v12 – v14)
   ------------------------------------------------------------------
   The AppV2 layout differs between releases:
     - v12:  foundry.applications.api.HandlebarsApplicationV2 and the
             top-level `template` option.
     - v13+: HandlebarsApplicationMixin(ApplicationV2) and static
             `PARTS` (the `template` option renders nothing).
   ────────────────────────────────────────────────────────────── */

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
      this.searchTerm = "";
      this.typeFilter = "all";
    }

    /** Context data handed to the Handlebars template. */
    async _prepareContext() {
      return { rows: collectRows() };
    }

    /** After render – bind the live filter controls. */
    async _onRender(context, options) {
      await super._onRender(context, options);
      bindFilterControls(this.element, this);
    }

    /** Action: open the sheet of the clicked document. */
    static async _onOpenSheet(event, target) {
      openDocumentSheet(target.dataset.docId);
    }
  };
}

/* ──────────────────────────────────────────────────────────────
   APPLICATION – legacy Application fallback
   ------------------------------------------------------------------
   Insurance for any environment where ApplicationV2 is not exposed
   when needed. Uses the long-lifespan (deprecation extends to v16)
   legacy Application class so the module keeps working.
   ────────────────────────────────────────────────────────────── */

class VisibilityAuditorAppV1 extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id:        TAG,
      title:     "Visibility Auditor",
      template:  TEMPLATE_PATH,
      width:     820,
      height:    600,
      resizable: true,
      classes:   ["visibility-auditor-app"],
    });
  }

  getData() {
    return { rows: collectRows() };
  }

  activateListeners(html) {
    super.activateListeners(html);
    const element = html[0] ?? html;

    const state = { searchTerm: "", typeFilter: "all" };
    bindFilterControls(element, state);

    element.querySelectorAll(".va-open-sheet").forEach(anchor => {
      anchor.addEventListener("click", (event) => {
        event.preventDefault();
        openDocumentSheet(anchor.dataset.docId);
      });
    });
  }
}

/* ──────────────────────────────────────────────────────────────
   APPLIICATION CLASS SELECTION (deferred until first use)
   ────────────────────────────────────────────────────────────── */

let _AuditAppClass = null;

function getAuditAppClass() {
  if (_AuditAppClass) return _AuditAppClass;

  const api = foundry.applications?.api ?? {};
  const isV13 = (game?.release?.generation ?? 0) >= 13;

  if (isV13 && api.HandlebarsApplicationMixin && api.ApplicationV2) {
    _AuditAppClass = createVisibilityAuditorApp(
      api.HandlebarsApplicationMixin(api.ApplicationV2),
      { usesParts: true },
    );
  } else if (api.HandlebarsApplicationV2) {
    _AuditAppClass = createVisibilityAuditorApp(api.HandlebarsApplicationV2, { usesParts: false });
  } else if (typeof Application === "function") {
    console.warn("Visibility Auditor | ApplicationV2 unavailable; falling back to the legacy Application class.");
    _AuditAppClass = VisibilityAuditorAppV1;
  } else {
    throw new Error("Visibility Auditor | No compatible base application class found.");
  }

  return _AuditAppClass;
}

/* ──────────────────────────────────────────────────────────────
   OPEN DIALOG
   ────────────────────────────────────────────────────────────── */

let _dialog = null;

function openAuditDialog() {
  if (!game.user.isGM) return;

  try {
    if (!_dialog) _dialog = new (getAuditAppClass())();
    _dialog.render(true);
  } catch (error) {
    console.error("Visibility Auditor | Failed to open the audit dialog:", error);
    ui.notifications?.error?.("Visibility Auditor: could not open the audit dialog – see the console.");
  }
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
      class:  "va-audit-control",
      icon:   "fas fa-user-shield",
      label:  "Audit Permissions",
      title:  "Audit Permissions",
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
  if (!(element instanceof HTMLElement)) return;

  const control = element.querySelector(".va-audit-control");
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

Hooks.once("init", () => {
  // Choose the directory-button mechanism for this Foundry version.
  // (Deferred to `init` because `game.release` may not be populated
  // when the module script is first evaluated.)
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
});

Hooks.once("ready", () => {
  // Expose the macro-callable API for every user; every entry point
  // internally enforces the Game Master-only restriction.
  const mod = game.modules.get("visibility-auditor");
  if (mod) {
    mod.api = { openDialog: openAuditDialog };
    console.log("Visibility Auditor | Module ready – API available at game.modules.get('visibility-auditor').api.openDialog()");
  }
});