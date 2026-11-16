## MODIFIED Requirements

### Requirement: Declared values
The Data explorer SHALL show a property value that arrives as a value object -- `@value` with its datatype as `type` or `@type` -- as that `@value`, and a number written as a string inside a value object of a numeric datatype as that number, whether it arrives with the entity or as a live update. Such a value SHALL be editable in place like a plain one, an edit SHALL keep its datatype unless the operator chooses another, and a live update SHALL highlight it only when its value changed.

#### Scenario: Declared double shown
- **WHEN** an entity's `temperature` arrives as `{"type": "http://www.w3.org/2001/XMLSchema#double", "@value": 42.5}`
- **THEN** the attribute shows `42.5`

#### Scenario: Declared double edited in place
- **WHEN** the operator edits that `temperature` in place and enters `80`
- **THEN** the value is saved, reads back as `80`, and is still a declared double in the broker

#### Scenario: Same value, other form
- **WHEN** a live update brings `{"type": "http://www.w3.org/2001/XMLSchema#double", "@value": "42.5"}` for a `temperature` shown as `42.5`
- **THEN** it is not highlighted as changed

#### Scenario: Changed declared value
- **WHEN** a live update brings `{"type": "http://www.w3.org/2001/XMLSchema#double", "@value": 43}`
- **THEN** the attribute shows `43` and is highlighted as changed

## ADDED Requirements

### Requirement: Instances of an attribute
For an attribute with several instances, the Data explorer SHALL show each instance's dataset after the attribute's name, as `name[dataset]`, and SHALL let the operator edit each instance's value in place and delete one instance alone, after confirmation, keeping the others. Adding a sub-attribute to an instance SHALL add it to that instance only, and the raw editor SHALL keep an instance's dataset.

#### Scenario: Datasets shown
- **WHEN** an attribute has a default instance and one with dataset `urn:ngsi-ld:Dataset:live`
- **THEN** the default instance's line shows the name alone and the other one `name[live]`, the dataset in its short form

#### Scenario: A lone default instance
- **WHEN** an attribute has one instance and no dataset
- **THEN** its line shows no dataset

#### Scenario: One instance edited
- **WHEN** the operator edits the value of the instance of one dataset
- **THEN** only that instance changes, and the others keep their values and sub-attributes

#### Scenario: One instance deleted
- **WHEN** the operator deletes the instance `name[dataset]` and confirms
- **THEN** that instance and its sub-attributes are removed, and the attribute's other instances remain

#### Scenario: Sub-attribute of the default instance deleted
- **WHEN** the operator deletes a sub-attribute of the default instance, beside an instance with a dataset that has the same sub-attribute
- **THEN** only the default instance loses it

#### Scenario: Sub-attribute added to an instance
- **WHEN** the operator adds a sub-attribute to an instance with a dataset
- **THEN** it is added to that instance only

#### Scenario: Raw edit of an instance
- **WHEN** the operator changes an instance in the raw editor and keeps its `datasetId`
- **THEN** the change is saved to that instance

### Requirement: Datatype of a value
The Data explorer SHALL show each property value's datatype as the platform reads it: a declared value's `@type`, else `xsd:integer` for a whole number, `xsd:double` for another number, `xsd:boolean`, or `xsd:string`, with a hint for a string that reads as a number. The editor SHALL offer `xsd:string`, `xsd:double`, `xsd:integer`, `xsd:boolean`, `xsd:dateTime` and any other datatype by its IRI, and a changed datatype SHALL write the value in that datatype's form.

#### Scenario: Datatypes shown
- **WHEN** an entity has the plain values `80`, `2.5`, `true` and `"on"`, and a value declared `xsd:double`
- **THEN** their lines show `xsd:integer`, `xsd:double`, `xsd:boolean`, `xsd:string` and `xsd:double`

#### Scenario: A number written as text
- **WHEN** a plain value is the string `"2.7"`
- **THEN** its line shows `xsd:string` with a hint that the platform's check of a double accepts it

#### Scenario: Text made an integer
- **WHEN** the operator changes a text value's datatype to `xsd:integer` and enters `6`
- **THEN** the plain number `6` is saved

#### Scenario: A whole number made a double
- **WHEN** the operator changes a value's datatype to `xsd:double` and enters `6`
- **THEN** `{"@value": 6, "@type": "http://www.w3.org/2001/XMLSchema#double"}` is saved

#### Scenario: A declared value made a string
- **WHEN** the operator changes a value declared `xsd:double` to `xsd:string`
- **THEN** the plain string is saved, without a datatype, and the line shows `xsd:string`

#### Scenario: Another datatype
- **WHEN** the operator picks another datatype and enters its IRI, such as `xsd:token`
- **THEN** the value is saved declared with that datatype, and without an IRI the editor asks for one

#### Scenario: Datatype kept
- **WHEN** the operator edits a value without changing its datatype
- **THEN** the edit is saved as before this change

#### Scenario: A plain whole number given a fraction
- **WHEN** the operator edits a plain `80`, shown as `xsd:integer`, to `80.5` without changing its datatype
- **THEN** the plain number `80.5` is saved

#### Scenario: A live update while editing
- **WHEN** a live update changes the datatype the value is read as while the operator edits it
- **THEN** the editor keeps the datatype it started from, and saving without choosing another one is an edit that keeps the datatype

### Requirement: Form of a value by its datatype
A value whose datatype the operator changed SHALL be written as the platform's typed-literals contract asks writers to: declared, `{"@value": …, "@type": <datatype IRI>}`, for `xsd:double`, `xsd:float`, `xsd:decimal`, `xsd:dateTime` and any other datatype; plain for `xsd:integer` and the other integer datatypes, `xsd:boolean` and `xsd:string`. A number SHALL be written as a JSON number, a boolean as `true` or `false`.

#### Scenario: Declared kinds
- **WHEN** the operator saves `2.5` as `xsd:double`, or `2026-11-15T10:00:00Z` as `xsd:dateTime`
- **THEN** `{"@value": 2.5, "@type": "http://www.w3.org/2001/XMLSchema#double"}`, or `{"@value": "2026-11-15T10:00:00Z", "@type": "http://www.w3.org/2001/XMLSchema#dateTime"}`, is saved

#### Scenario: Plain kinds
- **WHEN** the operator saves `7` as `xsd:integer`, `true` as `xsd:boolean`, or `on` as `xsd:string`
- **THEN** the plain values `7`, `true` and `"on"` are saved

#### Scenario: Not of the datatype's form
- **WHEN** the operator enters `tomorrow` as `xsd:dateTime`, or `yes` as `xsd:boolean`
- **THEN** it is refused as not a value of that datatype

### Requirement: Saving a refused value
When a value is refused as not of its datatype, or by the backend's checks, the editor SHALL keep it, show the reason and warn, and SHALL offer to save it anyway. A value not of its datatype SHALL then be saved declared with that datatype, as entered.

#### Scenario: Not of its datatype
- **WHEN** the operator enters `six` for a value of `xsd:double`
- **THEN** it is refused as not a value of `xsd:double`, nothing is saved, and the warning offers *Save anyway*

#### Scenario: Saved anyway
- **WHEN** the operator then chooses *Save anyway*
- **THEN** `{"@value": "six", "@type": "http://www.w3.org/2001/XMLSchema#double"}` is saved

#### Scenario: Refused by the backend
- **WHEN** the backend refuses an empty value and the operator chooses *Save anyway*
- **THEN** the empty value is saved
