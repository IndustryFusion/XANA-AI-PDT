# Design

## Context

An attribute with datasets is a list of instances, each with its `datasetId`; the default instance has none. The broker offers three ways to write one instance: an entity merge, a partial attribute update with `datasetId`, and writing the attribute with `POST /entities/{id}/attrs`. Only the last one leaves the other instances alone in every case; a merge with a `datasetId` replaces all instances. An entity merge also keeps a stored `@type` when it gets a plain value: `"3.1"` merged onto a declared `xsd:string` stays declared.

The backend checks an edit's value (*Wrong kind of value*: text for a number is refused) and keeps a declared value's datatype on an edit (*Edits of declared values*).

## Goals / Non-Goals

**Goals:** every instance editable and deletable on its own, without touching the others; a value's datatype visible and changeable, written as the platform's writers write it; a refused value writable on purpose.

**Non-Goals:** a datatype check beyond lexical forms; changing how the platform's checks judge plain strings.

## Decisions

### D1: An attribute with datasets is written whole

Changing or deleting one instance reads the attribute, replaces or drops that instance in the list, and writes the list with `POST /entities/{id}/attrs`. The last instance deleted removes the attribute. Edits at a path below an instance already work this way.

Deleting one instance writes the remaining ones the same way. NGSI-LD doesn't promise that such a write drops an instance left out; the broker in use does, as checked on a local platform, and the last instance goes with a delete of the attribute. One instance at a path, also for a delete of a sub-attribute, is named by its dataset, `@none` the default one.

*Alternatives:*
- A merge with `datasetId`. It replaces every instance.
- A partial attribute update with `datasetId`. It does nothing or mixes up instances on the broker in use.

### D2: The datatype as the platform reads it

The line shows a declared value's `@type`. For a plain value it shows the type JSON-LD gives it: a whole number `xsd:integer`, any other number `xsd:double`, a boolean `xsd:boolean`, a string `xsd:string`. A plain string that reads as a number gets a hint, as the platform's check of a double accepts it.

*Alternative:* show only declared datatypes. A plain `80` and a plain `80.5` would then look alike, although the platform reads one as an integer and the other as a double.

### D3: One datatype list, the form follows the datatype

The operator picks a datatype, not a JSON form. A changed datatype writes the value in that datatype's form, as the typed-literals contract asks writers to: `xsd:double`, `xsd:float`, `xsd:decimal`, `xsd:dateTime` and any other datatype declared, `{"@value": …, "@type": …}`; integers, booleans and strings plain. The value is checked against the datatype's lexical form first.

An edit that keeps the datatype is sent as today, and the backend keeps a declared value's datatype (*Edits of declared values*). So a plain number edited to a whole number stays plain. A plain number's datatype is JSON-LD's reading of it rather than a choice, so while it is kept any number is taken: a plain `80` can become `80.5`. A change is measured against the datatype the editing started from, so a live update while the editor is open is no change by the operator.

*Alternatives:*
- A choice of plain or declared beside the datatype. Two choices for one thing, and easy to get wrong.
- Always write the datatype's form, also without a change. A plain number edited would become declared, unlike today.

### D4: `exact` writes the whole attribute

With `exact`, the backend writes the value as given, without keeping the stored datatype, and writes the whole attribute rather than merging, as a merge would keep the stored `@type`. The explorer sends `exact` when the datatype changed, and for a value saved anyway as not of its datatype.

### D5: `force` skips the backend's value checks

`force` lets a value through that the backend's checks refuse: text for a number, an empty value. The explorer sends it only after a refusal and the operator's *Save anyway*, and with a changed datatype, which is a deliberate change of the value's kind. A value not of its chosen datatype is saved anyway declared with that datatype, as entered, so the platform sees exactly that value.

## Risks / Trade-offs

- A `force` write can store a value that raises alerts. That is its purpose, and it needs the warning and a second click.
- Writing an attribute whole replaces it in one request. The backend already runs one read-then-write at a time per entity (`_editing`), so only a change by another writer of the broker to another instance, between the read and the write, can be lost, as for edits at a path today.
