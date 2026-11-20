# Tasks

## 1. Delete by type

- [ ] 1.1 Add *Select all types* to the delete-by-type dialog (D1): all or none in the list's order, mixed state when some are selected, not offered for a single type; verify with unit tests for the mixed state, select and clear all, deleting every type with its count, and a single type, and with an end-to-end test that selects all, deletes and sees the list empty ("Select all types", "A single type", "Delete by type")

## 2. Relationship targets per instance

- [ ] 2.1 Keep a line's expanded targets, the targets moved out from it and its nested entity's key per instance, keep the sub-attribute toggle shared, and show only an instance's own targets (D2); verify with a unit test and an end-to-end test that expand one instance's target, then the other's, then collapse the first, and that both fail without the change ("One instance expanded", "Both expanded, then one collapsed"); verify that the existing test of the shared sub-attribute toggle passes unchanged ("Sub-attributes of the instances")
- [ ] 2.2 Let the mock data source import an attribute with several instances, checking each (D6); verify with a unit test for a valid and an invalid instance

## 3. The entity the address names

- [ ] 3.1 Frame, tint and label the entity the address names, with an arrival pulse only without reduced motion (D3); verify with a unit test that exactly one node is marked and labelled, an end-to-end test from an alert's resource link, and an end-to-end test that expanding another entity in the list moves the mark ("Marked as selected", "Expanded in the list", "Arrival without motion")
- [ ] 3.2 Bring the entity, or the attribute line the link names, into view once the results are there, again while loading content moves it for up to two seconds, and stop at the operator's first scroll, key or press (D4); verify with unit tests for the top, the middle, a moved node, the operator's scroll and a pinned entity, and with an end-to-end test that opens an alert's resource after scrolling down the explorer ("In view over the kept position", "Content loading above", "The operator scrolls")
- [ ] 3.3 Keep the scroll position once a frame while the page scrolls, with its address, and restore it at that address (D5); verify with an end-to-end test that scrolls away from an open entity, leaves through the navigation and comes back at the same position, failing on the main branch ("Back through the navigation", "Back to an open entity", "Back with the browser")

## 4. Checks

- [ ] 4.1 Run the frontend lint, unit tests, build, bundle check and end-to-end tests, and measure the unit-test coverage of the changed files; verify all pass and the coverage of the changed lines is above 80 %
- [ ] 4.2 On a local platform, check each part with the platform's broker and alerts: select all types (without confirming), expand two instances of a multi-relationship of an OPC UA entity, and open an alert's resource and attribute while the explorer was scrolled elsewhere; verify each behaves as its scenarios say
