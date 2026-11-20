# Tasks

## 1. Expand and collapse all

- [ ] 1.1 Add *Expand all relationships* to every entity node (D1, D2): expand targets in place level by level as they load, open sub-attributes, each entity once per tree, not shown-above, beyond the limit or moved-out targets, once per line; verify with unit tests and an end-to-end test ("Expand all", "Each entity once", "Limits of the tree", "Folded by hand", "Expand all again")
- [ ] 1.2 Add *Collapse all* to every entity node (D3): fold sub-attributes and targets in place, close raw JSON and history panes in the tree, end expanding there, and fold a node expanded in place into its relationship line; verify with unit tests and an end-to-end test ("Collapse all", "Collapse all of an entity expanded in place", "Collapse all keeps a moved-out entity's place")

## 2. Reading together

- [ ] 2.1 Collect the reads of entities and of attributes' latest states of one task into one request each, a single ID as before, missing IDs as not found (D4); verify with unit tests of the backend data source ("A level of a tree", "One entity", "Reading together fails", "Read anew")
- [ ] 2.2 Add the backend's endpoints for many entities and many latest states, bounded as in D5; verify with backend tests against the fake broker and time series ("Many entities", "An ID the broker's list can't hold", "An ID the broker refuses", "Too many IDs", "Latest states of many entities", "Latest states that can't be read", "Time series failing")

## 3. Checks

- [ ] 3.1 Run the frontend lint, unit tests, build, bundle check and end-to-end tests, and the backend's ruff checks and tests; measure the coverage of the changed code; verify all pass and the changed lines' coverage is above 80 %
- [ ] 3.2 On a local platform, expand all relationships of an OPC UA machine with a few hundred entities and collapse all again, and count the backend requests; verify the tree is shown and folded as the scenarios say and that the requests are a few per level
