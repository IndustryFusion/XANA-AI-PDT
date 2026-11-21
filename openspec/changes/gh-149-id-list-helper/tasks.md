# Tasks

## 1. The helpers

- [ ] 1.1 Add `_by_ids` and use it for the endpoints for many entities, the has-attribute filter and the import, with one chunk size (D1); verify with backend tests ("An existing ID with a comma in an import", "An import whose list the broker refuses", "An import the broker refuses to read", "The has-attribute filter with an ID with a comma", "The has-attribute filter with a list the broker refuses", "The has-attribute filter with a list too long", "Parameters the broker refuses", "A single read failing") and the existing tests of *Many entities at once*, *Import* and *Has-attribute filter* unchanged
- [ ] 1.2 Add `gather_bounded` and use it for the broker's single reads and the time series (D2); verify with the existing tests of the bounds on concurrent reads unchanged

## 2. Checks

- [ ] 2.1 Run the backend's ruff checks and tests and measure the coverage of the changed code; verify all pass and the changed lines' coverage is above 80 %
