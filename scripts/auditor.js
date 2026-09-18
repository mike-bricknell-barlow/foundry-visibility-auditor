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
  Actor:      "actors",
  JournalEntry: "journal",
  Item:       "items",
  Scene:      "scenes",
};

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
    type:         doc.documentName ?? doc.documentName,
    name:         doc.name ?? "(Unnamed)",
    defaultLevel: defaultLevel > 0 ? levelLabel(defaultLevel) : null,
    defaultSlug:  levelSlug(defaultLevel),
    players:      sharedPlayers,
    document:     doc,
  };
}

/* ──────────────────────────────────────────────────────────────
   APPLICATION
   ────────────────────────────────────────────────────────────── */

const TAG = "visibility-auditor-dialog";

/**
 * Resolve the ApplicationV2 base class that this module must extend.
 * The class path changed between Foundation releases:
 *   - v12 / v13: foundry.applications.api.HandlebarsApplicationV2
 *   - v14+:      HandlebarsApplicationV2 is removed; the same class is
 *                produced by the HandlebarsApplicationMixin.
 */
function resolveAppBase() {
  const api = foundry.applications?.api ?? {};
  if (api.HandlebarsApplicationV2) return api.HandlebarsApplicationV2;

  const { HandlebarsApplicationMixin, ApplicationV2 } = api;
  if (typeof HandlebarsApplicationMixin === "function" && ApplicationV2) {
    return HandlebarsApplicationMixin(ApplicationV2);
  }

  throw new Error("Visibility Auditor | No compatible ApplicationV2 base class found.");
}

const AppBase = resolveAppBase();

class VisibilityAuditorApp extends AppBase {
  constructor() {
    super({
      id:       TAG,
      title:    "Visibility Auditor",
      template: "modules/visibility-auditor/templates/audit-dialog.hbs",
      width:    820,
      height:   600,
      resizable: true,
      classes:  ["visibility-auditor-app"],
    });

    /** @type {string} */
    this._searchTerm = "";
    /** @type {string} */
    this._typeFilter = "all";
  }

  /* ── Static defaults ─────────────────────────────────── */

  static DEFAULT_OPTIONS = {
    actions: {
      openSheet: VisibilityAuditorApp._onOpenSheet,
    },
  };

  /* ── Context for the Handlebars template ─────────────── */

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

    return {
      rows,
      searchTerm: this._searchTerm,
      typeFilter: this._typeFilter,
    };
  }

  /* ── After first render – bind live filter controls ─── */

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

  /* ── Client-side filtering ───────────────────────────── */

  _applyClientFilters() {
    const tbody = this.element.querySelector(".va-table tbody");
    if (!tbody) return;

    const term = this._searchTerm.toLowerCase();
    const type = this._typeFilter;

    for (const row of tbody.querySelectorAll(".va-row")) {
      const name = row.querySelector(".va-cell-name")?.textContent?.toLowerCase() ?? "";
      const rowType = row.querySelector(".va-cell-type")?.textContent?.trim() ?? "";

      const matchesSearch = !term || name.includes(term);
      const matchesType  = type === "all" || rowType === type;

      row.style.display = (matchesSearch && matchesType) ? "" : "none";
    }
  }

  /* ── Action: open document sheet ─────────────────────── */

  static async _onOpenSheet(event, target) {
    const docId = target.dataset.docId;
    if (!docId) return;

    // Search all audited collections for the document
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
}

/* ──────────────────────────────────────────────────────────────
   HOOKS – sidebar header button
   ────────────────────────────────────────────────────────────── */

function addAuditButton(app, html) {
  if (!game.user.isGM) return;

  // Show the audit button only in the four supported directories.
  // Sidebar tabs are keyed by their tab name (e.g. "actors") but we
  // also fall back to the app class name for forward-compatibility.
  const AUDIT_TAB_NAMES = ["actors", "journal", "items", "scenes"];
  const AUDIT_CLASS_NAMES = [
    "ActorDirectory",
    "JournalEntryDirectory",
    "ItemDirectory",
    "SceneDirectory",
  ];

  const isAuditTab = AUDIT_TAB_NAMES.includes(app.tabName)
    || AUDIT_CLASS_NAMES.includes(app.constructor.name);

  if (!isAuditTab) return;

  const button = document.createElement("button");
  button.className = "va-audit-btn";
  button.title = "Audit Permissions";
  button.innerHTML = '<i class="fas fa-user-shield"></i>';
  button.addEventListener("click", () => openAuditDialog());

  // Insert into the directory header
  const header = html[0]?.querySelector(".directory-header")
    ?? html.querySelector?.(".directory-header");

  if (header) {
    header.appendChild(button);
  }
}

/* ──────────────────────────────────────────────────────────────
   HOOKS – ready
   ────────────────────────────────────────────────────────────── */

function openAuditDialog() {
  if (!game.user.isGM) return;
  const app = new VisibilityAuditorApp();
  app.render(true);
}

Hooks.once("ready", () => {
  // Expose the macro-callable API. Exposed for every user, but every
  // entry point internally enforces the Game Master-only restriction.
  const mod = game.modules.get("visibility-auditor");
  if (mod) {
    mod.api = { openDialog: openAuditDialog };
    console.log("Visibility Auditor | Module ready – API available at game.modules.get('visibility-auditor').api.openDialog()");
  }
});

Hooks.on("renderSidebarTab", addAuditButton);
