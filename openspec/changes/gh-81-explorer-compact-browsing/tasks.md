# Tasks

## 1. Backend

- [ ] 1.1 Add `GET /api/ngsi/prefixes`: read the configured context, follow its remote contexts within the limits, keep only namespace terms, cache for ten minutes, and on failure answer an empty list with a reason. Verify with stub tests for a context with prefixes, no context, an unreadable context, a caller-supplied address being ignored, a refused internal address, and the cache.
- [ ] 1.2 Accept `path` on `PATCH`, `POST` and `DELETE /entities/{id}/attrs`, applied at that depth with the rest kept, with `sub_attribute` still working. Verify with stub tests for changing, adding (including `conflict`) and deleting at depth 2 with several datasets, a missing level giving `not_found` with its name, and the old parameter.
- [ ] 1.3 Accept `path` on `GET /history`, resolving parent row ids level by level. Verify with stub tests that one sub-attribute's values are returned, a same-named sub-attribute under another parent is excluded, and the answer without `path` is unchanged.

## 2. Visual system

- [ ] 2.1 Set the compact scale in `src/ui/tokens.css` and move hard-coded sizes in `src/ui/` and `src/app/` onto tokens. Verify with a component test of computed sizes at the default font size and at a raised one, and with the axe suite on every area in both themes.
- [ ] 2.2 Add the SVG icon set and `IconButton` in `src/ui/`. Verify with component tests that each icon button has an accessible name and tooltip, uses the theme colour, and is focusable.

## 3. Data explorer

- [ ] 3.1 Add the explorer store, holding query, results, expansions, relationship expansions, unnested entities, pins, selection, the filter section and scroll, and make the navigation entry open the last explorer URL. Verify with component tests that leaving the area and coming back by the navigation and by Back restores the view, and that results are read again on return.
- [ ] 3.2 Keep pins and the full-IRI switch in `localStorage`, guarded. Verify with component tests for a reload, a pinned entity that no longer exists, and storage that throws.
- [ ] 3.3 Add the prefix registry and the `<Iri>` element: context, then well-known, then derived; stable until reload; hover, click to toggle, global switch, legend. Verify with unit tests for precedence, stability across two result sets, clashes, URNs and compacted terms, and a component test of the legend and the switch.
- [ ] 3.4 Rework the query bar: one main row, "More filters", and chips that clear their filter and apply the query. Verify with component tests for the chips and the URL, and a Playwright check that the first entity starts within 150 px of the bar at 1280 px width.
- [ ] 3.5 Make `AttributeLine` recursive for sub-attributes at any depth, with one expand control showing the count and tree lines, and edit, add, delete and history at every level using `path`. Verify with component tests on an entity with sub-attributes three levels deep, covering each action and the request it sends.
- [ ] 3.6 Extend the add form to every NGSI-LD kind and to a prefix plus local name. Verify with component tests that each kind is offered and that the saved name is the full IRI.
- [ ] 3.7 Replace the row text buttons with icon buttons that stay visible and muted. Verify with a component test that no row holds a text button, and with a keyboard test through a row.
- [ ] 3.8 Add the context menu on entity headers, attribute lines and `<Iri>` elements, opened by right-click, Shift+F10, the Menu key and a long press. Use `EntityRef`'s menu mode in the explorer, and drop destructive actions from entities nested in place. Verify with component tests for the items per target, focus returning on Escape, no incident controls in the rows, and none of these actions on nested entities.
- [ ] 3.9 Add unnest and re-nest, with the jump link, the separator and clearing on a new query. Verify with component tests that no write request is sent, re-nesting puts the entity back under its parent, and a pinned unnested entity survives a new query.
- [ ] 3.10 Add pinning for top-level and unnested entities, with the pinned count and unpinning a selection. Verify with component tests that a pinned entity is listed at the top for a query that doesn't match it.
- [ ] 3.11 Make the live-update indicator read `state` and `detail` (connecting while setting up, the reason shown while unavailable) and reconnect the socket with back-off. Verify with hook tests for `waiting_for_sign_in` after sign-in, `subscription_failed` with its reason, and reconnecting after a close.

## 4. Data sources and documents

- [ ] 4.1 Serve prefixes, sub-attribute paths and sub-attribute history from both the mock and the backend source, and document them. Verify with source tests that the two agree.
- [ ] 4.2 Update `frontend/docs/data-interface.md` and `architecture.md` (the Data explorer row, `src/ui/` and the `/api/ngsi/*` API row). Verify by reading the new entries.

## 5. Verification on the platform

- [ ] 5.1 Against the local environment's Scorpio with the platform's sample data, check in a browser that:
  - no type or attribute name shows as a full IRI by default;
  - a namespace keeps its prefix across two queries;
  - every row action is an icon;
  - the incident actions are only in the context menu.

  Verify with the Playwright backend suite and a manual check.
- [ ] 5.2 On a sub-attribute three levels deep, check change, add, delete and history, and that the rest of the attribute is unchanged. Verify by reading the entity back from the broker.
- [ ] 5.3 Unnest and pin a relationship target, run a new query, switch areas and come back, and reload. Verify that the view, then the query and pins, are as specified.
- [ ] 5.4 After signing in, check that the indicator shows connecting, then working, and never unavailable while the backend reports `active`. Verify in a browser against the backend.

## Workflow follow-up

- Open the proposal-only Pull Request for this change, and implement only after `spec-approved`.
- Archive with `/opsx:archive gh-81-explorer-compact-browsing` in a follow-up Pull Request after the merge.
