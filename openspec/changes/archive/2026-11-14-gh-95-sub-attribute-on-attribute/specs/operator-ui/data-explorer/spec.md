## MODIFIED Requirements

### Requirement: Edit attributes
The operator SHALL be able to change attribute and sub-attribute values in place on their line, add attributes and sub-attributes at any depth, and delete attributes, sub-attributes and entities, with suggested values where the data model provides them and confirmation before deleting. Adding SHALL offer every NGSI-LD attribute kind, and names built from the prefixes in use.

#### Scenario: Change a value with suggestions
- **WHEN** the operator selects the value of an attribute that has suggested values
- **THEN** the value becomes an input in place offering the suggestions, Enter saves and updates the value shown, and Escape cancels

#### Scenario: Rejected change
- **WHEN** a change is rejected
- **THEN** the editor stays open with the entered value and shows the reason

#### Scenario: Delete a sub-attribute
- **WHEN** the operator deletes a sub-attribute and confirms
- **THEN** only that sub-attribute is removed and the attribute remains

#### Scenario: Add a sub-attribute to an attribute
- **WHEN** the operator adds a sub-attribute to an attribute of any kind, a relationship included
- **THEN** it is saved under that attribute, the attribute keeps its value or target and stays one attribute, and the sub-attribute is shown under the attribute's expand control, which is open, and can be expanded and given sub-attributes of its own

#### Scenario: Add a sub-attribute at depth
- **WHEN** the operator adds a sub-attribute to a sub-attribute
- **THEN** it is saved under that sub-attribute, the rest of the attribute is unchanged, and it is shown at its place

#### Scenario: Every kind
- **WHEN** the operator opens the add form
- **THEN** it offers Property, Relationship, GeoProperty, JsonProperty, LanguageProperty, ListProperty and VocabularyProperty

#### Scenario: Name from a prefix
- **WHEN** the operator picks a prefix and enters a local name in the add form, or types `prefix:local` with a known prefix
- **THEN** the attribute is saved under the prefix's namespace followed by the local name, and is shown with its short name
