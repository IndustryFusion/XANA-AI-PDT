# Proposal

Issue: #117

## Why

The Data explorer edits an attribute with several instances (datasets) only in its raw JSON (#101): an instance's value can't be changed in place, one instance can't be deleted without the others, and the line doesn't say which dataset it shows. A value's type can't be changed either, since an edit keeps the stored datatype, and a value the checks refuse can't be written, although the explorer is also used to test how alerts react to wrong values (#117).

## What Changes

- **Instances:**
  - each instance's line names its dataset, `name[dataset]`;
  - each instance is editable in place and deletable on its own, after confirmation;
  - a sub-attribute added to an instance goes to that instance only;
  - the raw editor keeps an instance's `datasetId`.
- **Backend writes of one instance:** an attribute with datasets is written whole, with every instance, so the others stay. One instance is deleted by its dataset (`@none` for the default one), and adding accepts an attribute's instances as a list.
- **Datatype of a value:**
  - each property value shows its datatype as the platform reads it;
  - the editor offers `xsd:string`, `xsd:double`, `xsd:integer`, `xsd:boolean`, `xsd:dateTime`, and any other datatype by its IRI;
  - a changed datatype writes the value in that datatype's form, the way the platform's typed-literals contract asks writers to: doubles, decimals, dateTimes and other datatypes declared; integers, booleans and strings plain. An edit that keeps the datatype behaves as today.
  - the backend gets `exact`, which writes a value in the form given, as the whole attribute.
- **Save anyway:** a value refused as not of its datatype, or by the backend's checks, can be saved after a warning. The backend gets `force`, which skips its value checks.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `operator-ui/data-explorer`: *Declared values* (an edit keeps the datatype unless another is chosen); new *Instances of an attribute*, *Datatype of a value*, *Form of a value by its datatype*, *Saving a refused value*.
- `backend/explorer-api`: *Edits of declared values* (`exact`); new *Instances of an attribute*, *Writes the operator insists on*.

## Out of Scope

- Adding a sub-attribute by name, without a dataset, to an attribute with several datasets and no default instance (#101).
- Any datatype check beyond the lexical forms of the datatypes offered.
- The platform's own datatype checks, which judge a plain string by its text.

## Impact

Backend: `app/ngsi/broker.py`, `app/api/ngsi.py`. Frontend: the explorer's attribute line, value editor, entity view, raw editor and add form, the data source (backend and mock), and their tests.
