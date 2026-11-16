## MODIFIED Requirements

### Requirement: Short names for IRIs
The Data explorer SHALL show every http(s) IRI as `prefix:local`, or `prefix:` for a namespace, and never in full except in the raw JSON view. The full IRI SHALL appear only in the tooltip and through the context menu's "Show full IRI" and "Copy full IRI". Prefixes SHALL come from the configured context, then well-known vocabularies, then a name derived per namespace, and SHALL keep their namespace until reload.

#### Scenario: Platform data
- **WHEN** entities whose types and attributes are full IRIs are shown
- **THEN** each is shown as a short name, and hovering a short name shows its full IRI as tooltip

#### Scenario: Stable prefixes
- **WHEN** the operator runs a second query whose results hold a namespace seen in the first
- **THEN** that namespace has the same prefix as before

#### Scenario: Context first
- **WHEN** the configured context defines a prefix for a namespace
- **THEN** that prefix is used for it, rather than a well-known or derived one

#### Scenario: No configured context
- **WHEN** no context is configured, or its prefixes can't be read
- **THEN** well-known and derived prefixes are used, and the explorer works as usual

#### Scenario: No full view in place
- **WHEN** the operator clicks a short name, or looks for a setting to show names in full
- **THEN** the name stays short and no such setting exists; clicking does only what clicking that element otherwise does, such as following a relationship. Only a long name's middle can be shown in place, through its context menu (*Long names shortened in the middle*), and the full IRI still only in the tooltip and the menu

#### Scenario: Prefix legend
- **WHEN** the operator opens the prefix legend
- **THEN** every prefix in use is listed with where it comes from (context, well-known or derived), and each namespace is shown only in its tooltip and through its context menu

#### Scenario: Namespace of scheme and host only
- **WHEN** an IRI's namespace is only scheme and host, such as `http://example.org/x`, or the IRI is the bare `http://example.org`
- **THEN** it is shown with a prefix, such as `example:x` and `example:`

#### Scenario: IRI that is a namespace
- **WHEN** an IRI ends in `/` or `#`, such as `http://opcfoundation.org/UA/Pumps/`
- **THEN** it is shown as its prefix followed by a colon, such as `pumps:`

#### Scenario: Every http IRI has a prefix
- **WHEN** any http or https IRI is shown anywhere in the explorer outside the raw JSON view
- **THEN** it is shown with a prefix, and never unchanged

#### Scenario: URNs
- **WHEN** an identifier is a URN, such as `urn:ngsi-ld:Pump:1`, or a term without a colon that the broker compacted through a configured context
- **THEN** it is shown as it is, or shortened in the middle when it is long (*Long names shortened in the middle*): a URN is an entity identifier, not an IRI in a namespace, so this is not an exception to the rule

## ADDED Requirements

### Requirement: Long names shortened in the middle
The Data explorer SHALL show a URN or a prefixed name whose part after `urn:<nid>:` or `prefix:` is longer than 48 characters with that start, its first and last 6 characters and an ellipsis, such as `urn:uaentity:c3Z1PX…01MDE4`. Its tooltip SHALL hold the name in full, and the full IRI behind a prefixed name. Its context menu SHALL offer *Show in full* and then *Abbreviate*, besides the copy actions.

#### Scenario: A long URN
- **WHEN** a relationship's target is `urn:uaentity:` followed by 120 characters
- **THEN** it is shown as `urn:uaentity:`, the first 6 and the last 6 of them with an ellipsis between, on the relationship's line, with the URN in full as its tooltip

#### Scenario: A long prefixed name
- **WHEN** a vocabulary value's short name is `instanceExam:` followed by 120 characters
- **THEN** it is shown shortened the same way, with the prefixed name and the full IRI in its tooltip

#### Scenario: Shorter names unchanged
- **WHEN** a name such as `urn:ngsi-ld:Component:chiller-01-coolant-pump` or `pumps:hasDifferentialPressure` is shown
- **THEN** it is shown as before, with its tooltip and menu as before

#### Scenario: In full and back
- **WHEN** the operator chooses *Show in full* in a shortened name's context menu, and later *Abbreviate*
- **THEN** the name is shown in full in place, then shortened again; copying the identifier, the short name or the full IRI is offered as before

#### Scenario: A long heading
- **WHEN** an entity without a name is shown under the last segment of a long ID
- **THEN** its heading is shortened the same way, with the ID as its tooltip
