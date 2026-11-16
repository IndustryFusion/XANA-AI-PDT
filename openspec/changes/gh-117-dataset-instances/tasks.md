# Tasks

## 1. Backend

- [ ] 1.1 Write one instance of an attribute with datasets as the whole attribute, and delete one instance by its dataset, `@none` the default one (D1); verify with backend tests that the other instances stay, the last instance removes the attribute, and an unknown dataset is refused as `not_found`
- [ ] 1.2 Accept an attribute's instances as a list when adding; verify with a backend test, including a list with a typeless instance refused as `invalid`
- [ ] 1.3 Add `force` to updates (D5); verify with backend tests that a refused value is written with it, at the attribute and at a path of an instance, and refused without it
- [ ] 1.4 Add `exact` to updates (D4); verify with backend tests that a plain string, a plain integer, a declared string and a value not of its datatype are written whole as given onto a declared double, that a plain value is declared when given so, and that an instance and a sub-attribute at a path are not declared again

## 2. Data explorer

- [ ] 2.1 Show each instance's dataset as `name[dataset]`, and let each instance be edited and deleted alone (D1); verify with unit tests for the label, an edit and a delete of one instance, and the confirmation's text
- [ ] 2.2 Add a sub-attribute to an instance, and keep the dataset in the raw editor; verify with unit tests
- [ ] 2.3 Show each value's datatype and the number-text hint (D2); verify with unit tests for plain and declared values
- [ ] 2.4 Offer the datatype list and write a changed datatype in its form (D3); verify with unit tests for text made an integer, a whole number made a double, a declared double made a string, another datatype by its IRI, an unchanged datatype as before, and the form of each kind: `xsd:double` and `xsd:dateTime` declared, `xsd:integer`, `xsd:boolean` and `xsd:string` plain, and a text not of `xsd:dateTime` or `xsd:boolean` refused
- [ ] 2.5 Offer *Save anyway* after a refusal (D5); verify with unit tests for a value not of its datatype, saved declared as entered, and for a value the backend refuses
- [ ] 2.6 Extend the data source, backend and mock, with `datasetId`, `force` and `exact`; verify with the data-source tests

## 3. Checks

- [ ] 3.1 Run the backend and frontend suites, the build, the bundle check and the end-to-end tests; verify they pass
- [ ] 3.2 On the local platform, edit and delete one instance of an attribute with datasets, and change a value's datatype from a declared double to a string and back; verify the broker holds what the scenarios say
