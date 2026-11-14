# Proposal

Issue: #98

## Why

The Alerts area stops being usable once the list holds more than a few alerts (#98). The list scrolls sideways
on a laptop and on a phone, long cells wrap over several lines, and every row carries an actions button that
repeats its context menu. An alert names the attribute its validation checked by IRI, but the detail shows that
IRI as plain text, and the Data explorer can't be opened at an attribute. Leaving the area and coming back
drops the filter, the open alert and the checked rows.

## What Changes

- **Alert list:**
  - one line per alert, in fixed columns that fit the width, so the page never scrolls sideways;
  - a cell too long for its column is cut off, and its full text shows on hover;
  - narrower lists leave out the less important columns, which the detail still shows;
  - the resource is shown by its short name;
  - a new column shows the number of duplicates;
  - the row's actions button goes away, and the row's context menu (right click, Shift+F10 or the Menu key) also copies the resource IRI.
- **Alert detail:**
  - every IRI in the event, text, value, attributes and history gets a context menu;
  - an attribute of the alert's resource, or a sub-attribute named after `==>`, leads to that attribute in the Data explorer;
  - an entity IRI offers the entity's items;
  - every IRI can be copied;
  - the resource is shown as its full IRI, with the entity's context menu.
- **Data explorer:** a link can name an attribute path of the entity it opens. The explorer expands each level down to that attribute, brings its line into view and marks it.
- **Coming back:** the Alerts area keeps its filter, open alert, checked rows, last list and scroll position while the operator is in another area. Ending the session clears them.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `operator-ui/alerts`:
  - *Alert list* now describes the compact list;
  - *From an alert to its context* gains copying the resource IRI and the keyboard path through the row;
  - new: *IRIs in the alert detail* and *Alerts view is kept*.
- `operator-ui/data-explorer`: new requirement *Open at an attribute*.

## Out of Scope

- Changing which alerts are listed, their order, the filters or the actions.
- Choosing columns, or resizing them by hand.
- Keeping the Alerts view across a reload, beyond what the URL already holds.
- Validating that an attribute IRI in an alert exists on the resource. A path the entity doesn't have opens the entity as without a path.

## Impact

- Frontend: the Alerts area (list, detail, row menu, kept state), the Data explorer's entity view and attribute lines, and the app's entity path.
- Tests: the alerts and explorer unit tests, the alerts and layout end-to-end tests.
- Backend and API: none.
- architecture.md: none of its sections are affected.
