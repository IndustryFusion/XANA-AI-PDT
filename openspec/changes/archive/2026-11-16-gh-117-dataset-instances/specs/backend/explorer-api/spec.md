## MODIFIED Requirements

### Requirement: Edits of declared values
A declared number SHALL count as a number when an edit is checked, and an edit of a declared value SHALL send the new value declared with the stored datatype. An edit with `exact` SHALL send the value in the form given, plain or declared, without keeping the stored datatype, and SHALL write the attribute whole.

#### Scenario: Text for a declared number
- **WHEN** the operator sets a `temperature` stored as a declared double to `hot`
- **THEN** the change is refused as not a number, and the broker is not called

#### Scenario: A number for a declared number
- **WHEN** the operator sets that `temperature` to `80`
- **THEN** the backend sends `{"@value": 80, "@type": "http://www.w3.org/2001/XMLSchema#double"}`, and reading the entity back gives 80

#### Scenario: A plain number edited
- **WHEN** the operator edits a `temperature` stored as the plain number `42.5`
- **THEN** the edit behaves as before

#### Scenario: Exact plain value
- **WHEN** a `temperature` stored as a declared double is set to the string `"2.7"` with `exact`
- **THEN** the backend writes the attribute whole with the plain string, its unit and sub-attributes kept, and reading it back gives `"2.7"` without a datatype

#### Scenario: Exact declared value
- **WHEN** a plain value is set to `{"@value": 80, "@type": "http://www.w3.org/2001/XMLSchema#double"}` with `exact`
- **THEN** the backend writes that value as given

#### Scenario: Exact value of an instance or at a path
- **WHEN** an instance with a dataset, or a sub-attribute at a path, is set with `exact`
- **THEN** the value is written as given, and the stored datatype is not kept

## ADDED Requirements

### Requirement: Instances of an attribute
The backend SHALL change one instance of an attribute with datasets by writing the attribute whole with every instance, the changed one replaced. With `dataset_id` and no path, a delete SHALL remove that instance alone, `@none` the default one, and the attribute with its last instance; at a path, `@none` SHALL name the default instance too. Adding SHALL accept an attribute's instances as a list.

#### Scenario: One instance changed
- **WHEN** the instance of one dataset gets a new value
- **THEN** the backend writes the attribute with every instance, that one changed, and the others stay as they were

#### Scenario: One instance deleted
- **WHEN** a delete names an attribute and the dataset of one of its instances
- **THEN** only that instance is removed, and the others stay

#### Scenario: The default instance deleted
- **WHEN** a delete names an attribute and the dataset `@none`
- **THEN** the default instance is removed, and the instances with a dataset stay

#### Scenario: A sub-attribute of the default instance
- **WHEN** a delete names a sub-attribute of an attribute with several instances and the dataset `@none`
- **THEN** it is removed from the default instance only, and the other instances keep theirs

#### Scenario: The last instance
- **WHEN** the only remaining instance is deleted
- **THEN** the attribute is removed

#### Scenario: No such instance
- **WHEN** a change or delete names a dataset the attribute has no instance of
- **THEN** the request is refused as `not_found`, and nothing is changed

#### Scenario: Instances added as a list
- **WHEN** an attribute is added as a list of instances, each with a type
- **THEN** it is stored with those instances, and a list with an instance without a type is refused as `invalid`

### Requirement: Writes the operator insists on
An update with `force` SHALL skip the backend's value checks, so that text for a number or an empty value is written. Without `force`, the checks SHALL apply as before.

#### Scenario: Forced text for a number
- **WHEN** text is given for a numeric value with `force`
- **THEN** it is written

#### Scenario: Forced value at a path
- **WHEN** a sub-attribute at a path of an instance gets a value the checks refuse, with `force`
- **THEN** it is written

#### Scenario: Not forced
- **WHEN** the same change is sent without `force`
- **THEN** it is refused as `invalid`, with the reason, and nothing is changed
