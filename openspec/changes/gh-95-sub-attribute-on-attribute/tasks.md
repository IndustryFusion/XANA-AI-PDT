# Tasks

## 1. Tests first

- [x] 1.1 Explorer API unit tests: adding a sub-attribute with `name` and no path to a property (with a unit) and to a relationship writes the whole attribute once with the attribute-level update, keeps its value or target, and an existing name is refused as `conflict` with only reads sent; verify they fail before the change
  - `tests/test_explorer_broker.py`: a property with a unit and a relationship, each written once with the attribute-level update; an existing name refused as `conflict` with only reads. The two write tests fail before the change; the conflict test passes before too, as the old route refused the name as an existing attribute.
- [x] 1.2 Real-broker test: add a sub-attribute to a property and to a relationship with `name` and no path, then one below it, and read back type and value at both levels, with the attribute keeping its value or target; verify it fails before the change against the platform's Scorpio image and passes on the local environment's broker after it
  - `tests/test_explorer_real.py::test_a_sub_attribute_added_to_the_attribute_itself_is_one`, for a property and a relationship. Against `ibn40/scorpio-all-in-one-runner:v0.7.0-latest` both fail before the change and pass after; CI runs them against the local environment's broker.
- [x] 1.3 Frontend data-source test: adding a sub-attribute to the attribute itself sends the attribute's name and no path parameter, with the attribute and its sub-attribute as body; verify it fails before the change
  - `tests/data/backendSource.test.js`: fails before the change (no `name` sent).

- [x] 1.4 Explorer API tests for D3 and D4: an update that brings a new sub-attribute to a relationship is one attribute-level write; one without a type is `invalid` with only reads; a write of a whole attribute arms the delivery check, a deletion or a deeper path doesn't; the real-broker `test_add_and_change_a_sub_attribute` and the new test also check that the attribute's other sub-attributes stay; verify the unit tests fail before the change and the real-broker ones against the platform's broker
  - `test_explorer_broker.py`: `test_an_update_that_brings_a_new_sub_attribute_writes_the_attribute_back`, `test_an_update_with_a_new_sub_attribute_without_a_type_is_invalid`; `test_live_updates.py::test_only_writes_that_the_broker_notifies_expect_a_delivery` extended. All three fail before the change. Real broker: `test_add_and_change_a_sub_attribute` fails before the change against the platform's Scorpio image and passes after; the new real-broker test also compares the attribute's other sub-attributes.

## 2. Explorer API

- [x] 2.1 Let the add route take `name` without a path and add the sub-attributes to that attribute through the write-back of D1; verify tasks 1.1 and 1.2 pass
  - `api/ngsi.py`: the add route sends `name` without a path to the write-back with an empty path. Tasks 1.1 and 1.2 pass.
- [x] 2.3 Write back attributes whose update brings a new sub-attribute (D3), and let a write of a whole attribute arm the delivery check (D4); word the refusal of a body that holds another attribute for a name without a path too; verify task 1.4 passes
  - `broker.py`: `_update_attributes` writes back an attribute that gains a sub-attribute (`_new_sub_attributes`), `_changes_entities` counts `/entities/{id}/attrs/{name}`; `api/ngsi.py`: the refusal names the attribute, with or without a path. Task 1.4 passes; backend unit suites 1290 passed, 512 skipped. The mock data source also refuses the attribute's own members as sub-attribute names, like the backend (`tests/data/entities.test.js`).
- [x] 2.2 Run the backend unit suites and lint; verify they pass
  - 1288 passed, 512 skipped (real-broker tests without a broker); `ruff check .` and `ruff format --check .` pass.

## 3. Data explorer

- [x] 3.1 Send every sub-attribute add from the add form with the attribute's name and its path (D2), in the backend and the mock data source; verify task 1.3 and the explorer's add tests pass
  - `AddAttributeForm.jsx` adds every sub-attribute with `{ path, sub: true }`; `entities.js` sends `name` for it; the mock data source takes the same contract. Task 1.3 and the explorer's add tests pass.
- [x] 3.2 Run the frontend lint, unit tests, build and bundle check; verify they pass
  - eslint passes; 874 passed, 5 skipped; build and bundle check pass.

## 4. Verification

- [x] 4.1 On the local Kubernetes environment with the platform's broker, add a sub-attribute to a property and to a relationship in the explorer, expand it, add one below it and expand that; verify each is shown with its kind and value, and the relationship is shown once
  - Explorer on the local Kubernetes environment with the platform's broker: a sub-attribute and one below it added through the forms to a Property and to a Relationship; both levels are shown with kind and value under the open expand controls, and the relationship is one line.
- [x] 4.2 Run `openspec validate --all --strict`; verify it passes
  - 35 passed.
