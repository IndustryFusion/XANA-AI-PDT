# Tasks

## 1. Shortening

- [x] 1.1 Shorten a long URN or prefixed name in the middle, keeping its start (D1); verify with unit tests for each kind, for names that stay as they are, and that an http IRI itself is never shortened
  - `frontend/tests/explorer/declaredValues.test.jsx`, *long names shortened in the middle*: a URN, a prefixed name and a bare name shortened; `urn:ngsi-ld:Component:chiller-01-coolant-pump`, `pumps:hasDifferentialPressure` and an http IRI as they are.
- [x] 1.2 Offer *Show in full* and *Abbreviate*, and the name in full in the tooltip (D2); verify with a unit test on a relationship's long target
  - `explorer.test.jsx`, *a long ID is shortened in the middle, in full in its tooltip, and shown in full and back from its menu*, also that a name shown in full is shortened again when another value takes its place; the existing tooltip tests of *Short names for IRIs* pass unchanged.
- [x] 1.3 Shorten a heading that falls back to a long ID's last segment (D3); verify with a unit test
  - *an entity without a name under a long ID has its heading shortened, with the ID as its tooltip*: a URN's last segment and an http ID's short name, and a name with an ellipsis left as it is.

## 2. Checks

- [x] 2.1 Run the frontend lint, unit tests, build, bundle check and end-to-end tests; verify they pass
  - eslint, the unit tests, the build, the bundle check and 173 end-to-end tests.
- [x] 2.2 On the local platform, open an OPC UA entity; verify its heading, ID, relationship target and vocabulary value are shortened, and that a name is shown in full and back from its menu
  - On a local IFF platform, an OPC UA pump's heading read `c3Z1PX…01MDE4`, its relationship target `urn:uaentity:c3Z1PX…01MDE5` on the relationship's line with the URN as its tooltip, and its vocabulary value `instanceExam:c3Z1PX…01MDE4`; *Show in full* showed the target's 125 characters and *Abbreviate* shortened it again.
