# Tasks

## 1. The alert detail

- [ ] 1.1 Read the detail's alert at the list's interval as well as after actions and *Refresh now* (D1, D5); verify with a unit test that a change made elsewhere shows in the open detail at the next refresh ("Detail follows the refresh")
- [ ] 1.2 Close the detail, replacing the address with the list's and keeping the filter, once a read finds an alert it showed not ended closed, expired or gone, and move keyboard focus that was in the detail to the list (D1, D2, D4); verify with unit tests for closing from the detail, a close elsewhere seen at the next refresh, a deletion, a failed read and the focus, each failing without the change, and with an end-to-end test that closes an alert from its detail and checks the address and going back ("Alert ends while shown")
- [ ] 1.3 Keep the detail open for an alert that had already ended when it was opened, under a status filter that lists its new status, and after shelving, and close it once the filter no longer lists that status (D2, D3); verify with unit tests for each ("Already ended", "Filter lists the new status", "Filter no longer lists the new status", "Shelved from the detail")

## 2. Checks

- [ ] 2.1 Run the frontend lint, unit tests, build, bundle check and end-to-end tests, and measure the unit-test coverage of the changed files; verify all pass and the coverage of the changed lines is above 80 %
- [ ] 2.2 On a local platform with Alerta, close an open alert from its detail, and open a closed alert from the *Closed* list; verify the first detail closes and the second stays open
