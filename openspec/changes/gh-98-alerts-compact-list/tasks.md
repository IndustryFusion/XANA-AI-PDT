# Tasks

## 1. Alert list

- [ ] 1.1 Lay out the list as in D1, with fixed columns, cut-off cells with their full text as tooltip, a wrapping failure reason, and columns left out by the list's width; verify with an end-to-end test at 1280, 1024 and 390 pixels, with and without the detail open, that the page doesn't scroll sideways, that the rows take one line each, and that cut-off cells end with an ellipsis and carry their full text
- [ ] 1.2 Show the resource by its short name with its full IRI as tooltip, and add the duplicates column; verify with unit tests that the resource, event, text and service cells carry their full text as tooltip, the resource as its full IRI, and that the duplicates column shows the number or is empty without duplicates
- [ ] 1.3 Remove the row's actions button and add *Copy resource IRI* to the row menu (D2); verify with unit tests that a row holds no button, that the menu lists its items in order, and that Shift+F10 on the event link opens it; update the end-to-end test that used the button
- [ ] 1.4 Keep the reason of a failed action in full; verify with the partial-failure unit test that the action's results give the reason and that the row's cell with the reason wraps instead of being cut off

## 2. Alert detail

- [ ] 2.1 Split the detail's event, text, value, attributes and history into text and IRIs, classified as in D3; verify with a unit test that attributes, sub-attributes after `==>`, entities and vocabulary terms are told apart and that the parts join back to the text
- [ ] 2.2 Give each IRI its context menu, and show the resource as its full IRI with the entity's menu; verify with unit tests that an attribute IRI leads to the explorer path of the resource and attribute, that the keyboard opens an entity IRI's menu with its items, and that a vocabulary term offers only copying

## 3. Data explorer

- [ ] 3.1 Accept `focus` in the entity link and expand, scroll to and mark the named line (D4); verify with unit tests that a link to a sub-attribute with a dataset index expands the levels above and marks only that line, and that a path the entity doesn't have marks nothing

## 4. Kept view

- [ ] 4.1 Remember the Alerts address for the main navigation and keep the checked rows, the last list and the scroll position for the session (D5); verify with unit tests that coming back through the navigation shows the same address, open alert and checked rows, that the last list is shown before the next answer and then replaced by it, that the scroll position is restored, and that the view is forgotten when the session ends

## 5. Checks

- [ ] 5.1 Run the frontend lint, unit tests, build, bundle check and the end-to-end tests; verify they pass
- [ ] 5.2 On the local platform, check the list at 1280, 1024 and 390 pixels with real alerts, and follow an attribute IRI from an alert to the explorer; verify the list doesn't scroll sideways and the attribute's line is marked
