# Tasks

## 1. Backend

- [x] 1.1 Write one instance of an attribute with datasets as the whole attribute, and delete one instance by its dataset, `@none` the default one (D1); verify with backend tests that the other instances stay, the last instance removes the attribute, and an unknown dataset is refused as `not_found`
  - `tests/test_explorer_broker.py`: *updating one instance keeps the others*, *one dataset changes and the other stays*, *updating the only instance with a dataset keeps its dataset*, *one instance is deleted and the others kept* (`@none`, then the last instance removes the attribute), *deleting an instance that isn't there changes nothing* (`not_found`); *a sub-attribute of the default instance is deleted from it alone* (`@none` at a path).
- [x] 1.2 Accept an attribute's instances as a list when adding; verify with a backend test, including a list with a typeless instance refused as `invalid`
  - *an attribute with several instances can be added*, including a list with a typeless instance refused with 422.
- [x] 1.3 Add `force` to updates (D5); verify with backend tests that a refused value is written with it, at the attribute and at a path of an instance, and refused without it
  - *a value the checks refuse is written when forced* (refused without `force`) and *a forced value at a path is written too*.
- [x] 1.4 Add `exact` to updates (D4); verify with backend tests that a plain string, a plain integer, a declared string and a value not of its datatype are written whole as given onto a declared double, that a plain value is declared when given so, and that an instance and a sub-attribute at a path are not declared again
  - *an exact value is written whole as given* for `"2.7"`, `80`, a declared `xsd:string` and `{"@value": "abc", "@type": xsd:double}` onto a declared double, each through the attribute write with the unit kept; *a plain value is declared when written exact*; *an exact value of an instance and at a path is not declared again*.

## 2. Data explorer

- [x] 2.1 Show each instance's dataset as `name[dataset]`, and let each instance be edited and deleted alone (D1); verify with unit tests for the label, an edit and a delete of one instance, and the confirmation's text
  - `tests/explorer/explorer.test.jsx`: *multi-attributes show one line per instance, named with its dataset, and each instance is edited in its dataset* (labels, an edit of one instance, the delete and its confirmation) *the default instance beside one with a dataset can be deleted alone* and *a sub-attribute of the default instance is deleted from that instance alone*; *unit, observation time and dataset on the line…* for a lone instance with a dataset.
- [x] 2.2 Add a sub-attribute to an instance, and keep the dataset in the raw editor; verify with unit tests
  - *a sub-attribute added to one instance goes to that instance only*; `tests/explorer/rawEdit.test.js`, *an instance with a dataset keeps it…*.
- [x] 2.3 Show each value's datatype and the number-text hint (D2); verify with unit tests for plain and declared values
  - `tests/explorer/declaredValues.test.jsx`, *the datatype of a value and its form*: `80`, `2.5`, `true`, `"on"`, a declared double and a declared dateTime, and the number-text mark; the line's `xsd:string · number text` in *a declared value shows its datatype, and becomes a plain string when that is chosen*.
- [x] 2.4 Offer the datatype list and write a changed datatype in its form (D3); verify with unit tests for text made an integer, a whole number made a double, a declared double made a string, another datatype by its IRI, an unchanged datatype as before, and the form of each kind: `xsd:double` and `xsd:dateTime` declared, `xsd:integer`, `xsd:boolean` and `xsd:string` plain, and a text not of `xsd:dateTime` or `xsd:boolean` refused
  - `explorer.test.jsx`: *the datatype is chosen beside the value, and written in its form…* (text made an integer, a whole number made a double), *a declared value … becomes a plain string*, *any other datatype is named by its IRI…* (and asks for one), the unchanged datatype in *a sub-attribute value is edited in place* (a plain `0.5` stays plain), *a plain whole number takes a fraction while its datatype is kept* and *a live update while the editor is open is no datatype change*; `declaredValues.test.jsx` for the form of each kind and the refusals of `tomorrow`, `yes`, `six` and `1.5`.
- [x] 2.5 Offer *Save anyway* after a refusal (D5); verify with unit tests for a value not of its datatype, saved declared as entered, and for a value the backend refuses
  - *a text not of the datatype is said at once, and can be saved anyway, declared as it is* and *a value the checks refuse can be saved anyway, after the warning*.
- [x] 2.6 Extend the data source, backend and mock, with `datasetId`, `force` and `exact`; verify with the data-source tests
  - `tests/data/entities.test.js`: *rejects a text for a numeric value unless forced…* and *an update names its instance by its dataset…*; `tests/data/interface.test.js` for the shapes.

## 3. Checks

- [x] 3.1 Run the backend and frontend suites, the build, the bundle check and the end-to-end tests; verify they pass
  - Backend: ruff, 1191 tests and 134 agent tests. Frontend: eslint, 937 unit tests, the build, the bundle check and the end-to-end tests. The value editor's datatype choice has the small control height, level with its buttons (layout test).
- [x] 3.2 On the local platform, edit and delete one instance of an attribute with datasets, and change a value's datatype from a declared double to a string and back; verify the broker holds what the scenarios say
  - On a local IFF platform's broker, through the backend: an attribute with a default, a `live` and a `spare` instance; editing `live` changed it alone, a sub-attribute went to `spare` alone, deleting `spare` and then `@none` left the others. A declared double written as the plain string `"2.7"` read back without a datatype, then `{"@value": 80, "@type": xsd:double}` read back declared; a plain merge left a declared `xsd:string` declared, as D4 says.
