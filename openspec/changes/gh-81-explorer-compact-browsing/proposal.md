# Proposal

Issue: #81

## Why

On the platform's data the Data explorer is hard to read and slow to work with:
- **Full IRIs.** Types and attribute names are full IRIs, such as `http://opcfoundation.org/UA/Pumps/…`.
- **Size.** Text and controls are large, and the query card takes about 400 px before the first entity.
- **Text buttons.** The row actions are words.
- **Incident actions.** These sit behind an arrow next to every identifier.
- **Uneven nesting.** Sub-attributes stop after one level, and history is offered only at the top.
- **Lost state.** The whole view resets when the operator leaves the area.
- **Live status.** "Live updates unavailable" also appears while live updates are still being set up after sign-in, and never says why.

## What Changes

- **Compact type scale.** The base text is 14 px, attribute rows 13 px, meta information 12 px, and controls 32 px. This is set in the design tokens, so every area follows.
- **Compact query bar.** One row holds type, entity ID and Search. A collapsible "More filters" section holds the ID pattern, has-attribute, attributes to return, limit and conditions. While it is collapsed, the filters that are set show as removable chips.
- **Short names for IRIs.**
  - **Where.** Types, attribute names, entity IDs, relationship targets and IRI values are shown as `prefix:local`.
  - **Where the prefixes come from.** In order: the prefixes of the configured JSON-LD context, which the backend now offers; a fixed list of well-known vocabularies; and a short name derived per namespace, which stays the same until the page is reloaded.
  - **Seeing the full IRI.** Hovering shows it. Clicking switches one name between short and full, and a switch shows every name in full.
  - **Legend.** A legend lists the prefixes in use.
- **Icon actions.** History, edit, add sub-attribute, delete, raw JSON, pin, unnest and re-nest are icon buttons from one SVG set. Each has a tooltip and an accessible name, and stays visible, muted, without hovering.
- **One context menu.** Right-click, Shift+F10 or the Menu key on an entity, attribute or IRI opens one menu: copy the short name, copy the full IRI, copy the value, open in the Data explorer, start a new incident, show active incidents, show incident history. The "▾" button next to identifiers in the explorer goes.
- **The same row at every depth.**
  - **Any depth.** Sub-attributes can be shown, edited, extended and deleted at any depth.
  - **History.** It can be opened wherever an attribute has an observation time.
  - **Expand control.** One chevron with the number of children expands and collapses everything, and tree lines show the nesting.
  - **Adding.** The add form offers every NGSI-LD attribute kind, and names from the prefixes in use.
  - **Nested entities.** Entities expanded in place no longer carry delete or raw JSON.
- **Unnest and re-nest.** An entity expanded in place can be moved out to the top of the list, and back under its parent. This changes the view only.
- **Pinning.** Top-level and unnested entities can be pinned. A pinned entity stays at the top of the list through new queries and reloads, until it is unpinned.
- **Kept state.** Leaving the Data explorer and coming back, through the navigation or Back, shows the same query, results, expansions, unnested entities, pins and scroll position.
- **Live status with its reason.** The indicator shows the backend's reason. While the backend sets live updates up, it says "connecting", not "unavailable".

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `operator-ui/data-explorer`:
  - Query bar layout.
  - Entity view at every depth.
  - The context menu replacing row controls.
  - Editing and history at every depth.
  - The live-update indicator.
  - New: short names for IRIs, icon actions, unnest and re-nest, pinning, kept state.
- `operator-ui/visual-system`: a compact type and control scale.
- `backend/explorer-api`: the prefixes of the configured JSON-LD context; changing, adding and deleting sub-attributes at any depth, and their history.

## Impact

- **`frontend/`:**
  - `src/ui/` (tokens, an icon set, the context menu).
  - `src/features/explorer/` (query bar, entity node, attribute line, add form, live updates, a store for the explorer's state).
  - `src/app/EntityRef.jsx`.
  - Both data sources (the prefixes operation).
  - `docs/data-interface.md`.
  - Tests.
- **`backend/`:** `app/api/ngsi.py` and `app/ngsi/` (reading the configured context's prefixes; sub-attribute paths for edits, deletes and history), and tests.
- **Dependencies:** no new runtime dependency.
- **`architecture.md`:**
  - The Frontend section: the Data explorer row, and the `src/ui/` key file, which gains the icon set.
  - The API table row for `/api/ngsi/*`: prefixes.

## Out of Scope

- **Other areas' row actions.** Icons replace text in the Data explorer only. Other areas pick up only the compact type scale.
- **Live updates in the backend.** How the backend checks and reports live updates. A broker that refuses to read a subscription by its ID is #82.
- **Prefixes in the agent.** Short names in agent output, run views or incident history.
- **Pins across browsers.** Sharing pins between operators or browsers. Pins are kept per browser.
- **Editing prefixes.** Operators can't define or rename prefixes.
