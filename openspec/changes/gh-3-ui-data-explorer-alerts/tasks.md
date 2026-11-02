# Tasks

## 1. Mock data

- [ ] 1.1 Extend the seed with every attribute kind, history series generation, deletion records and alert history; verify seed tests that each attribute kind exists and references still resolve
- [ ] 1.2 Implement the mock `entities` operations (`listTypes`, `listAttributes`, `queryEntities` with `q` evaluation, `getEntity`, `updateAttributes`, `appendAttributes`, `deleteAttribute`, `deleteEntity`, `importEntities`, `fetchImportDocument`, `deleteByTypes`, `getAttributeHistory`, `listTypesAt`, `queryEntitiesAt`, `subscribeEntities`, `getLiveUpdateHealth`, `getValueHints`); add result shapes; verify data-interface shape tests and behaviour tests for query, edit, time-shift and live updates
- [ ] 1.3 Implement the mock `alerts` operations (`listAlerts`, `getAlert`, `applyAlertAction`, `listEnvironments`, `listServices`) and occasional new alerts in development; verify shape tests and filter/sort/action tests
- [ ] 1.4 Document mock specifics (time-shift approximation, sample import URLs) in `frontend/docs/data-interface.md`; verify the documentation test passes

## 2. Data explorer

- [ ] 2.1 Implement the explorer page with URL-backed query bar, query builder with expression preview, entity list, empty and invalid-query states; verify component tests (spec: data-explorer → Query entities)
- [ ] 2.2 Implement the entity view with attribute renderers per kind, sub-attributes, metadata, raw JSON toggle and not-found state; verify component tests per attribute kind (spec: data-explorer → Entity view)
- [ ] 2.3 Implement relationship and IRI navigation and the context menu including copy; verify component tests and back navigation (spec: data-explorer → Relationship and IRI navigation)
- [ ] 2.4 Implement attribute editing with value hints, add attribute, delete attribute/sub-attribute/entity with confirmation and error retention; verify component tests (spec: data-explorer → Edit attributes)
- [ ] 2.5 Add Recharts and implement the history pane (time ranges, chart, table, unit, empty range), loaded on demand; verify component tests and that the dashboard bundle does not include the chart library (spec: data-explorer → Attribute history)
- [ ] 2.6 Implement time-shift with banner, disabled editing and return to present; verify component tests (spec: data-explorer → Time-shift)
- [ ] 2.7 Implement import (file and URL, preview, validation, per-entity results) and delete-by-type dialogs; verify component tests (spec: data-explorer → Import and bulk delete)
- [ ] 2.8 Implement live updates toggle, health indicator and change highlighting; verify component tests with fake timers (spec: data-explorer → Live updates)

## 3. Alerts

- [ ] 3.1 Implement the alerts page with severity summary, URL-backed filters, default filter, sorting, empty state and refresh interval; verify component tests (spec: alerts → Severity summary, Filters, Alert list)
- [ ] 3.2 Implement selection and single and bulk actions with notes and per-alert results; verify component tests including partial failure (spec: alerts → Alert actions)
- [ ] 3.3 Implement alert detail with attributes and history, and the context jumps including new incident with proposed issue text; verify component tests (spec: alerts → Alert detail, From an alert to its context)

## 4. Integration checks

- [ ] 4.1 Replace the explorer and alerts placeholders; add end-to-end tests: query → entity → relationship → history; edit and time-shift; import a sample file; alert filter → bulk acknowledge → detail → start incident; verify all pass
- [ ] 4.2 Extend the accessibility suite to the explorer (entity view, history, dialogs) and alerts (list, detail) in both themes; verify zero axe violations and keyboard operation
- [ ] 4.3 Run `openspec validate gh-3-ui-data-explorer-alerts --strict` and the Frontend CI; verify both pass and record per-scenario results in the Pull Request

## Workflow follow-up

- A maintainer adds the `spec-approved` label before any task above starts.
- After merge, archive with `/opsx:archive gh-3-ui-data-explorer-alerts`, together with the other changes of issue #3.
