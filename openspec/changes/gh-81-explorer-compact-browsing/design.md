# Design

## Context

The Data explorer has these parts:
- **Query.** It is a card: two rows of 40 px controls, the condition builder, and Apply (`QueryBar.jsx`).
- **Entities.** Each entity is an `EntityNode`, and each attribute an `AttributeLine`.
- **Sub-attributes.** They are a flat list one level deep, with fewer actions than attributes.
- **History.** It is offered only for top-level attributes.
- **Identifiers.** Each is an `EntityRef`: a link, and a "▾" button that opens copy, open and incident actions.
- **Context menu.** `ui/ContextMenu.jsx` handles right-click and Shift+F10, but is used only in Alerts.
- **State.** The explorer is unmounted when the operator leaves the area. Only the query and the last entity are kept, in the URL, and the navigation entry always opens the bare `/explorer`.

The backend has these limits:
- **Context.** It sends `NGSI_CONTEXT_URL` as the Link header, but offers nothing about the context to the UI. With no context set, which is the Helm default, names come as full IRIs.
- **Deleting sub-attributes.** It deletes one level of sub-attribute (`sub_attribute`).
- **Live-update health.** It reports `status` (`ok`/`unavailable`) together with `state` and `detail`. The UI reads only `status`, so the states while the backend is setting up show as unavailable.

**Conflicts with the specs.** `operator-ui/app-shell` "Cross-navigation from entity references" asks that every entity reference *offer* open, start incident, active incidents and history. Inside the Data explorer, this change offers them through the context menu instead of a visible button. The requirement is still met, because it doesn't say how they are offered, so it isn't modified. Other areas keep the "▾" button.

There is no conflict with `architecture.md`. Its Frontend section ("design tokens … no CSS framework") and the rule against new runtime dependencies shape the icon decision below.

## Goals / Non-Goals

**Goals:**
- One attribute line component, recursive, used at every depth.
- One place that decides how an IRI is shown, used by every part of the explorer.
- The explorer's view state outlives the area being unmounted.

**Non-Goals:**
- A general state library or router change for other areas.
- Compacting IRIs in the backend's answers. Attribute names stay as the broker gives them ("Query and browse"), and short names are for display only.

## Decisions

### Compact scale through the tokens

The tokens are set as follows:

| Token | Value | Pixels at the default font size |
|---|---|---|
| `--text-md` | 0.875rem | 14 px |
| `--text-sm` | 0.8125rem | 13 px |
| `--text-xs` | 0.75rem | 12 px |
| `--control-height` | 2rem | 32 px |
| `--control-height-sm` | 1.75rem | 28 px |

The spacing scale stays. Components that hard-code sizes are moved onto the tokens. Because the values stay in `rem`, the browser's font-size setting still scales everything.

**Alternatives:**
- A smaller root font size: it would also shrink spacing and borders, and break any `rem` used as a length.
- A compact mode for the explorer only: the issue asks for all areas.

### Query bar

The query bar is laid out like this:
- **Main row.** It holds type (a select with free text), entity ID and Search.
- **"More filters".** A disclosure button opens the rest: ID pattern, has-attribute, attributes to return, limit, and the condition builder. Whether it is open is kept with the explorer's state.
- **Chips.** While it is collapsed, every filter that is set and differs from its default is a chip. Removing a chip clears that filter and applies the query.
- **Controls.** The multi-select for attributes becomes a select with suggestions that adds chips, so it no longer takes 2–5 rows.

**Alternative:** a side panel for the filters. It takes width from the entity tree, which is the part that needs width for nesting.

### Short names: one registry, three sources

`features/explorer/prefixes.js` holds one registry per page load, kept in the explorer store (below):
- **Lookup.** Asked for an IRI, it finds the longest registered namespace that is a prefix of it, and returns `prefix:local`.
- **Unknown namespaces.** For an http(s) IRI with no registered namespace, it registers one. The namespace is the IRI up to and including its last `#`, or else its last `/`.
- **Registered names.** A registered name never changes until the page is reloaded.

Namespaces are registered in this order of precedence:

1. **The configured context**, from the new `GET /api/ngsi/prefixes`, loaded once when the explorer first mounts.
2. **A fixed list of well-known vocabularies** in the module:
   - NGSI-LD core;
   - `rdf`, `rdfs`, `xsd`, `owl`, `sh`;
   - `schema`, `saref`;
   - the OPC UA base namespace and its companion specifications used on the platform, such as `http://opcfoundation.org/UA/Pumps/` → `pumps` and `…/UA/DI/` → `di`;
   - IndustryFusion's base and knowledge ontologies (`iffb`, `iffk`).
3. **A derived name.** It is the last path segment of the namespace that isn't a version (`v1`, `v0.1`) or a generic word (`www`, `ontology`, `contexts`), lower camel case, cut to 12 characters. A clash gets a numeric suffix (`pumps2`). Without a usable segment the name is `ns1`, `ns2` and so on.

A name that is not an http(s) IRI is shown unchanged. That includes URNs and terms the broker already compacted through a configured context.

Display components get a `<Iri value kind>` element from the registry:
- **The element.** It shows the short name, with the full IRI as `title`. Clicking toggles it between short and full.
- **Context menu.** It handles the context menu.
- **Global switch.** A switch in the explorer's header ("Full IRIs") is kept in `localStorage`, read and written inside try/catch.
- **Legend.** The legend lists the registry's entries with their source: context, well-known or derived.

**Alternatives:**
- **Derive prefixes from each result set.** This is how the earlier browser did it. The same `ns0` then names a different namespace after the next search, so short names can't be trusted.
- **Only rely on `NGSI_CONTEXT_URL`.** The broker would compact the names itself, but only where a deployment sets a context that covers every namespace, and the platform's sample data uses OPC UA namespaces that its contexts don't define.
- **Compact in the backend.** It would change attribute names in answers, which "Query and browse" forbids, and edits need the full names.

### Prefixes route

`GET /api/ngsi/prefixes` answers `{"prefixes": [{"prefix", "namespace"}], "detail": null | reason}`.

**Reading.** Only the configured `NGSI_CONTEXT_URL` is read. The caller's parameters are ignored, as in "Own configuration only". The answer is cached for ten minutes in the backend.

**Following remote contexts.** The context's `@context` may be an object, a URL, or an array of both. Remote contexts it names are followed in the same way, depth-first, up to 2 levels and 8 documents. Only http(s) addresses are followed, and addresses that the URL import refuses are refused here too.

**Which terms count.** A term counts as a prefix when its value is a string IRI, or an object whose `@id` is a string IRI, ending in `/` or `#`. Keywords and `@vocab` are not prefixes.

**Failures.** A fetch or parse failure gives an empty list and a reason without the address or token, with HTTP 200. The UI then falls back to its other sources, which fits graceful degradation.

**Alternative:** let the frontend fetch the context itself. The UI then reaches outside addresses directly, and a page served under the Ingress's content security rules may be blocked. It also bypasses the address rules the backend already applies.

### Sub-attributes at any depth

**Deleting.** `DELETE /entities/{id}/attrs` keeps `name` and `sub_attribute` for compatibility, and also accepts `path`, which is repeated, one entry per level below `name`. `sub_attribute=x` is the same as one `path=x`.

**Changing and adding.** `PATCH` and `POST /entities/{id}/attrs` accept `path` the same way. The body is the attribute fragment for the deepest level named.

**How the backend applies it.** It reads the top-level attribute, with every dataset, and walks the path. A missing level gives `not_found`, naming that level. It then applies the change at that level, and writes the whole top-level attribute back with an attribute-level PATCH. The existing per-attribute lock serialises concurrent writes to the same attribute.

**In the UI.** `AttributeLine` renders its sub-attributes as `AttributeLine`s with `path` and `depth`, so every level has the same actions:
- **History.** It is offered where the line has `observedAt`, with the history query naming the path.
- **Indentation.** It is `depth × 16px`, with a tree line drawn by a left border on the list.
- **Relationship targets expanded in place.** They keep `MAX_DEPTH = 5`. Sub-attribute depth is bounded only by the data.

**History of sub-attributes.** The time-series store keeps a sub-attribute's rows under its own name (`attributeId`), with `parentId` holding the parent row's `id`, which is unique per attribute and dataset. Top-level rows have no `parentId`, and the current reads already filter on that. `GET /history` takes `path` the same way as the edit routes. The backend:

1. finds the parent's row ids level by level, reading `id` for `attributeId` = name and `parentId` = the previous level's ids, where top level means `parentId` is null;
2. reads the values for the last name with `parentId=in.(…)`.

Without `path`, the answer is unchanged.

**Alternative:** the frontend builds the merged attribute and sends it whole. It needs the same read-merge-write, but with a race between operators. The backend already has the lock.

### Icons

The icons are a small in-house SVG set in `src/ui/icons.jsx`:
- **Glyphs.** History, edit, add, delete, raw JSON, pin, pinned, unnest, re-nest, chevron, copy, link and more. Each is 16 px, drawn with `currentColor` strokes, so both themes and the contrast rules apply.
- **`IconButton`.** It renders an icon inside a 28 px button, with `aria-label` and a tooltip. Row actions are muted (`--text-muted`) and turn to full contrast on hover and focus. They are never hidden.

**Alternatives:**
- **An icon library** such as Lucide: a new runtime dependency the specs don't call for.
- **Emoji or Unicode glyphs:** they render differently on each system, and ignore the theme's colours.

### Context menu

`ui/ContextMenu.jsx` is reused:
- **Opening.** Entities' headers, attribute lines and `<Iri>` elements open it on `contextmenu`, on Shift+F10 or the Menu key, and on a long press for touch.
- **Items.** They depend on the target: copy short name, copy full IRI, copy value, open in the Data explorer, start a new incident, show active incidents, show incident history. The incident and open items are built by the same function `EntityRef` uses now, so their behaviour stays as in "Cross-navigation from entity references".
- **`EntityRef`.** Its "▾" button gets a `menu="context"` mode that drops the button, used inside the explorer.
- **Nested entities.** They render their header without delete and raw JSON.

**Alternative:** a visible "⋯" button per row. It's discoverable, but it brings back a control in every row, which is what the issue removes. Keyboard users still have Shift+F10.

### Explorer state: a store outside the component

`features/explorer/store.js` is a module-level store, read through `useSyncExternalStore`. It survives the area being unmounted. It holds:
- the query and paging;
- the result entities;
- the expanded entity IDs, and the expanded attribute paths per entity;
- the relationship expansions;
- the unnested entities, the pins and the selection;
- whether "More filters" is open;
- the scroll position.

**Returning to the explorer:**
- **The navigation entry.** It goes to the last explorer URL, kept in the store, instead of the bare `/explorer`. That still satisfies "Addressable screens", as the URL still holds the query and entity.
- **Remounting.** Results are shown from the store at once and read again in the background. Values that changed are updated without a flash, which meets "Values brought up to date".
- **Scroll.** It is restored after the first paint.

**What is kept where:**
- **Pins** go to `localStorage` as entity IDs. After a reload they are read again by ID, and an ID that's gone shows as not found with an unpin action.
- **The query** is already in the URL.
- **Expansions** aren't kept on reload, as the spec states.

**Alternatives:**
- **Keep every area mounted and hidden**, as the earlier browser did. It keeps live sockets and polling running for hidden areas, and holds every area's memory.
- **Put everything in the URL.** Expansions and unnested entities make URLs that are too long, and changing a pin shouldn't add a history entry.

### Unnest and re-nest

**Unnest.**
- **Effect.** It adds the entity, with its current expanded paths, to the store's `unnested` list, recording the parent and attribute it came from. Unnested entities render after the results, under a labelled separator.
- **The parent's line.** The relationship line shows a "go to" icon instead of the nested node, which scrolls to the unnested entity and focuses it.
- **Requests.** None. The view only.

**Re-nest.** It removes the entity from the list. The relationship line shows the nested node again if it is expanded.

**A new query** clears the unnested entities that aren't pinned.

### Live-update indicator

The hook reads `state` and `detail` from the health answer:
- `active` → working.
- `connecting`, and `waiting_for_sign_in` while the UI has a session → connecting. The backend hasn't caught up with the sign-in yet.
- Every other state → unavailable.

The `detail` is shown in the indicator's tooltip and as visible text next to it while unavailable. The WebSocket still reports `unavailable` on close. After that, while health is `ok`, the hook reconnects with a back-off of 1, 2, 5 and 10 s, instead of waiting for the next 10 s poll.

## Risks / Trade-offs

- **[Smaller text everywhere can break layouts or contrast in other areas]** → Run the axe and Playwright suites on every area in both themes, and check the 900 px breakpoint. Areas with hard-coded sizes are moved onto tokens in the same change.
- **[Derived prefixes can mislead, e.g. `pumps` for a namespace that isn't OPC UA's]** → Every short name shows its full IRI on hover, the legend states where each prefix came from, and the global switch shows full IRIs.
- **[A context with many remote imports makes the prefix route slow]** → The limits on depth and documents, the existing health timeout per fetch, and the ten-minute cache. The UI doesn't wait for it before showing results: names are re-rendered when the prefixes arrive.
- **[Read-merge-write for deep sub-attributes can overwrite a concurrent change made outside this backend]** → It's the same window the existing sub-attribute delete has. A live update arriving during an edit shows the newer value.
- **[Results kept in memory can be stale]** → They are always read again on return, and live updates keep them current while shown.
- **[Context menu actions are less discoverable than buttons]** → The row's tooltip names the menu ("Right-click or Shift+F10 for more"). The app-shell requirement is still met.

## Migration Plan

Frontend and backend deploy together through the chart, as usual. The new route and the `path` parameter are additions: `sub_attribute` still works, so an older frontend keeps working against the new backend. Pins and the full-IRI switch start empty. Rolling back drops them harmlessly.
