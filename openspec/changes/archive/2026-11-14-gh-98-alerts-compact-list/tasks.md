# Tasks

## 1. Alert list

- [x] 1.1 Lay out the list as in D1, with fixed columns, cut-off cells with their full text as tooltip, a wrapping failure reason, and columns left out by the list's width; verify with an end-to-end test at 1280, 1024 and 390 pixels, with and without the detail open, that the page doesn't scroll sideways, that the rows take one line each, and that cut-off cells end with an ellipsis and carry their full text
  - `e2e/alerts.spec.js`: *at 1280/1024/390 px the alert list fits without scrolling sideways, one line per alert*, for the list and an open alert, checks overflow, row heights and the ellipsis with its tooltip. It failed before cells were kept on one line (the age wrapped) and passes after.
- [x] 1.2 Show the resource by its short name with its full IRI as tooltip, and add the duplicates column; verify with unit tests that the resource, event, text and service cells carry their full text as tooltip, the resource as its full IRI, and that the duplicates column shows the number or is empty without duplicates
  - `tests/alerts/alerts.test.jsx`: *cut-off cells carry their full text, the resource as its full IRI, and the duplicates column counts duplicates*; the default list test checks the resource's short name and full IRI.
- [x] 1.3 Remove the row's actions button and add *Copy resource IRI* to the row menu (D2); verify with unit tests that a row holds no button, that the menu lists its items in order, and that Shift+F10 on the event link opens it; update the end-to-end test that used the button
  - `tests/alerts/alerts.test.jsx`: the default list test (no button in a row), *a right click on a row…* (menu items in order, with *Copy resource IRI*), *Shift+F10 on the row's event opens the same menu…*; `e2e/alerts.spec.js` opens the menu with Shift+F10 instead of the removed button.
- [x] 1.4 Keep the reason of a failed action in full; verify with the partial-failure unit test that the action's results give the reason and that the row's cell with the reason wraps instead of being cut off
  - `tests/alerts/alerts.test.jsx`: *partial failure…* checks the reason in the results and that the row's cell with it wraps.

## 2. Alert detail

- [x] 2.1 Split the detail's event, text, value, attributes and history into text and IRIs, classified as in D3; verify with a unit test that attributes, sub-attributes after `==>`, entities and vocabulary terms are told apart and that the parts join back to the text
  - `tests/alerts/alerts.test.jsx`: *names attributes, sub-attributes after ==>, entities and vocabulary terms apart*, including that the parts join back to the text.
- [x] 2.2 Give each IRI its context menu, and show the resource as its full IRI with the entity's menu; verify with unit tests that an attribute IRI leads to the explorer path of the resource and attribute, that the keyboard opens an entity IRI's menu with its items, and that a vocabulary term offers only copying
  - `tests/alerts/alerts.test.jsx`: *a right click on an attribute IRI goes to it in the data explorer…*, *the keyboard opens the menu of an entity IRI in the text*, *a vocabulary term in the text only offers copying its IRI*.

## 3. Data explorer

- [x] 3.1 Accept `focus` in the entity link and expand, scroll to and mark the named line (D4); verify with unit tests that a link to a sub-attribute with a dataset index expands the levels above and marks only that line, and that a path the entity doesn't have marks nothing
  - `tests/explorer/compact.test.jsx`: *a link that names an attribute path opens each level down to it and marks that line* and *a link that names an attribute the entity does not have…*.

## 4. Kept view

- [x] 4.1 Remember the Alerts address for the main navigation and keep the checked rows, the last list and the scroll position for the session (D5); verify with unit tests that coming back through the navigation shows the same address, open alert and checked rows, that the last list is shown before the next answer and then replaced by it, that the scroll position is restored, and that the view is forgotten when the session ends
  - `tests/alerts/alerts.test.jsx`: *after another area, the filters, the open alert and the checked rows are as they were left*, *the last list is shown at once, at the scroll position it had, and the next answer replaces it*, *when the session ends, the Alerts area forgets its view*. Each fails without its part of the change.

## 5. Checks

- [x] 5.1 Run the frontend lint, unit tests, build, bundle check and the end-to-end tests; verify they pass
  - eslint passes; 885 passed, 5 skipped; build and bundle check pass; end-to-end 173 passed, 2 skipped, and with the knowledge base 118 passed, 1 skipped.
- [x] 5.2 On the local platform, check the list at 1280, 1024 and 390 pixels with real alerts, and follow an attribute IRI from an alert to the explorer; verify the list doesn't scroll sideways and the attribute's line is marked
  - Local platform with 23 validation alerts: no sideways scroll and equal row heights at 1280, 1024 and 390 pixels, with and without the detail; the menu of `…/Pumps/hasMotorVoltage` in an alert's text opened the explorer with that attribute's line marked and in view.
