# Spec Delta

## ADDED Requirements

### Requirement: Paging through results
The Data explorer SHALL page through query results beyond the first page, with the page kept in the URL.

#### Scenario: Next and previous
- **WHEN** a query has more matches than the limit
- **THEN** the explorer shows which matches are shown and the total when known, and next and previous pages can be opened until the last

#### Scenario: Page in the URL
- **WHEN** the operator opens a URL holding a query and a page
- **THEN** that page of results is shown

#### Scenario: New query
- **WHEN** the operator changes the query
- **THEN** the results start again at the first page

### Requirement: Attribute selection and has-attribute filter
The Data explorer SHALL let the operator choose the attributes to return, and filter to entities that have a given attribute, from the attributes the broker knows, and keep both in the URL.

#### Scenario: Choose attributes
- **WHEN** the operator selects attributes to return and applies the query
- **THEN** the listed entities show only those attributes

#### Scenario: Has attribute
- **WHEN** the operator sets "Has attribute" to an attribute and applies the query
- **THEN** only entities that have it are listed, each whole

### Requirement: Import replaces
The import dialog SHALL say, before the operator confirms, that importing replaces entities that already exist and removes attributes that are not in the file.

#### Scenario: Preview
- **WHEN** the operator previews an import
- **THEN** the dialog says that existing entities are replaced, and the result lists replaced entities as updated
