# Tasks

## 1. Tests first

- [ ] 1.1 Explorer API unit tests: adding a sub-attribute with `name` and no path to a property (with a unit) and to a relationship writes the whole attribute once with the attribute-level update, keeps its value or target, and an existing name is refused as `conflict` with only reads sent; verify they fail before the change
- [ ] 1.2 Real-broker test: add a sub-attribute to a property and to a relationship with `name` and no path, then one below it, and read back type and value at both levels, with the attribute keeping its value or target; verify it fails before the change against the platform's Scorpio image and passes on the local environment's broker after it
- [ ] 1.3 Frontend data-source test: adding a sub-attribute to the attribute itself sends the attribute's name and no path parameter, with the attribute and its sub-attribute as body; verify it fails before the change

- [ ] 1.4 Explorer API tests for D3 and D4: an update that brings a new sub-attribute to a relationship is one attribute-level write; one without a type is `invalid` with only reads; a write of a whole attribute arms the delivery check, a deletion or a deeper path doesn't; the real-broker `test_add_and_change_a_sub_attribute` and the new test also check that the attribute's other sub-attributes stay; verify the unit tests fail before the change and the real-broker ones against the platform's broker

## 2. Explorer API

- [ ] 2.1 Let the add route take `name` without a path and add the sub-attributes to that attribute through the write-back of D1; verify tasks 1.1 and 1.2 pass
- [ ] 2.3 Write back attributes whose update brings a new sub-attribute (D3), and let a write of a whole attribute arm the delivery check (D4); word the refusal of a body that holds another attribute for a name without a path too; verify task 1.4 passes
- [ ] 2.2 Run the backend unit suites and lint; verify they pass

## 3. Data explorer

- [ ] 3.1 Send every sub-attribute add from the add form with the attribute's name and its path (D2), in the backend and the mock data source; verify task 1.3 and the explorer's add tests pass
- [ ] 3.2 Run the frontend lint, unit tests, build and bundle check; verify they pass

## 4. Verification

- [ ] 4.1 On the local Kubernetes environment with the platform's broker, add a sub-attribute to a property and to a relationship in the explorer, expand it, add one below it and expand that; verify each is shown with its kind and value, and the relationship is shown once
- [ ] 4.2 Run `openspec validate --all --strict`; verify it passes
