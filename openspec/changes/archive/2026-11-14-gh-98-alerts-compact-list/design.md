# Design

## Context

The alert list is a table with automatic column widths and an actions button per row. The context menu of a row
already offers every action of that button. The alert detail shows the alert's text and attributes as plain text.
Alerts raised by the shape validation name the checked attribute by IRI, `[0]` for a dataset, and a sub-attribute
below it as `attribute ==> sub-attribute`.

The Data explorer opens an entity from `/explorer/<id>`. It keeps its own view while the operator is in another
area (*Explorer state is kept*), and the main navigation returns to the place an area last remembered. Until now
the Alerts area hasn't remembered one.

## Goals / Non-Goals

**Goals:**
- An alert list that fits any width the app supports, from 390 to 1280 pixels and wider, without scrolling sideways.
- One way from an IRI in an alert to the attribute it names.
- The Alerts area as the operator left it.

**Non-Goals:**
- New alert data, filters or actions; columns the operator chooses or resizes.
- Checking that an alert's attribute IRI exists on the resource.

## Decisions

### D1: Fixed column widths, cut-off cells, columns left out by the list's own width

The table uses a fixed layout:
- the select, severity, status, age and duplicates columns get fixed widths;
- resource, event and service get shares of the width, and text takes the rest;
- cells stay on one line, end in an ellipsis when cut off, and carry their full text as a tooltip;
- the reason of a failed action is the exception: it wraps, so it can always be read in full.

The list leaves out columns by its own width, not the window's, because the detail beside it narrows the list
without a change of window:
- below about 960 pixels it leaves out the service;
- below about 700 pixels, the status too;
- below about 560 pixels it keeps the selection, severity, resource and event.

The shares of the other columns leave the text a visible width wherever it is shown. A left-out column is
collapsed to no width rather than removed, so cells stay in their columns. On a phone, where the text column is
left out, the reason of a failed action is read in the action's results, which list it per alert.

*Alternatives:*
- A horizontally scrolling table: this is today's behaviour, and #98 rejects it.
- Window media queries: they miss the narrowing by the detail.
- A card layout on phones: a second rendering of the same rows to keep in step.
- Wrapping cells: few alerts per screen.

### D2: The row menu is the only place for row actions

The actions button goes away. The menu still opens by:
- a right click anywhere on the row;
- Shift+F10 or the Menu key on the row's checkbox or event link, which are the row's focusable controls.

Its items stay as they were. *Copy resource IRI* is added, since the list now shows the resource by its short
name only. The list's caption tells screen-reader users that each row has a context menu.

*Alternatives:* keep the button, which costs a column and repeats the menu; or make the whole row focusable, which
adds a tab stop per row next to the checkbox and the link.

### D3: IRIs in the detail are found in the text, and classified by form

The detail's event, text, value, attributes and history are split into plain text and IRIs: `http(s)://…` and
`urn:…`. Each IRI drops trailing punctuation and a dataset index. The parts are classified as follows:
- an `http(s)` IRI is an attribute of the alert's resource;
- such an IRI preceded by `==>` after another attribute IRI is a sub-attribute of that attribute;
- a `urn:` IRI is an entity;
- IRIs of the XML Schema, RDF, RDF Schema and SHACL vocabularies are terms, never attributes.

Each IRI gets a context menu, using the same menu as the rest of the app:
- for an attribute, *Go to the attribute in the data explorer*, *Copy IRI* and *Copy resource IRI*;
- for an entity, the entity reference's items, the first one named *Go to the entity in the data explorer*, plus *Copy IRI*;
- for a term, *Copy IRI* alone.

The resource itself is shown as the full IRI, with the entity reference's menu.

*Alternatives:*
- Look the IRI up in the resource's entity before offering the item. That needs a broker read for every alert
  shown, and a missing attribute is already handled by D4.
- Parse the validation's message format exactly. That ties the UI to one producer's wording.
- Links instead of menus. Links can't offer copy, and they change how the text reads.

### D4: The explorer takes an attribute path as `focus` in the entity link

`/explorer/<id>?focus=<JSON array of levels>`: an attribute name, then each sub-attribute name. A level may carry a
dataset index (`name[0]`), which matches the name. Only the entity the URL opens reads `focus`:
- a line on the path expands its sub-attributes;
- the named line scrolls into view and is marked.

An unreadable `focus` value, or a path the entity doesn't have, is ignored, and the entity opens as without one.
`focus` lives in the address like the query, so the browser's back button returns to it.

*Alternatives:*
- A fragment (`#…`). Fragments are used for in-page anchors, and the router doesn't keep them.
- Dotted names. IRIs contain dots.
- A kept-state entry instead of the URL. That couldn't be bookmarked or shared.

### D5: The Alerts area keeps its view in memory for the session

The address already holds the filter and the open alert. The area now remembers it for the main navigation, as the
explorer does. The checked rows, the last list per request and the scroll position are kept in memory:
- the last list is shown at once and replaced by the next answer;
- all of it is cleared when the session ends, like every area's kept place, so the next operator in the tab
  starts afresh;
- a reload starts with nothing checked.

*Alternatives:*
- Session storage: it survives a reload, which isn't asked for, and holds alert data in the browser longer.
- Putting the checked rows in the URL: long addresses, and they would be shared with a link.

## Risks / Trade-offs

- [The IRI classification is heuristic] → A non-vocabulary `http` IRI that isn't an attribute of the resource gets a
  *Go to the attribute* item that opens the entity unmarked (D4). Copying always works.
- [Cut-off cells hide text] → The tooltip and the detail show it in full. A failed action's reason never cuts off.
- [Kept results can be stale] → They show only until the first answer of the same request, which is fetched on return.
