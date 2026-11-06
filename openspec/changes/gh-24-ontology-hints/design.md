# Design

## Findings: what was checked first

From the platform's chart, Makefile, tests and API notes, and a real Fuseki.

| Question | Finding | Consequence |
|---|---|---|
| Endpoints | `/<realm>/sparql` for queries. The dataset is named after the realm, default `iff`. | `FUSEKI_URL` and `FUSEKI_DATASET`. |
| Graphs | Named graphs `<base>/shacl.ttl` and `<base>/knowledge.ttl`, and no union default graph. | Queries name both graphs. |
| Graph base | `http://<externalHostname>/<realm>`, from the external host name, so it **differs from the service address** `fuseki:3030`. | `FUSEKI_GRAPH_BASE`. Without it, the base is `<FUSEKI_URL>/<dataset>`, which suits only a local Fuseki. |
| Auth | The service `fuseki:3030` has no check itself. The ingress forwards to an authentication service requiring `Factory-Admin` or `Factory-Reader` under `resource_access.fuseki.roles`. | The operator's token is sent when there is one. Through the ingress, operators need that role, or hints are `none` with the reason. |
| Shape form | `sh:targetClass`, `sh:property` with `sh:path <attribute>`, and an inner `sh:property` with `sh:path ngsi-ld:hasValue` or `hasObject`, holding `sh:in`, `sh:minInclusive`, `sh:maxExclusive`, `sh:datatype` or `sh:class`. | The query follows this form. |
| Classes | `knowledge.ttl` holds `rdfs:subClassOf` and individuals, such as `ontology:executingState a ontology:MachineState`. | Shapes on a parent class apply, and `sh:class` lists its individuals as allowed values. |
| Updates | `/sparql` refuses update requests (415). | The read function also refuses them, with a clear message. |
| `SERVICE` | **Fuseki attempts a `SERVICE` call to any URL in a query**, which would let a query reach internal addresses. | The read function refuses `SERVICE`. |

## Decisions

### 1. Values in queries

An IRI is checked against the characters SPARQL allows in `<...>`; anything else is not placed in a query, and the answer is `none` or an error as data. A short name goes in as a string literal, with `\` and quotes escaped. A value with a control character or a `\u` code point escape is not placed at all, because SPARQL decodes those escapes before its grammar applies. A short name is compared with the local part of IRIs in the graph, so short names work on the sample data. Tests parse the resulting queries with a SPARQL parser, and check that hostile input yields the same query structure as a harmless name. They also run hostile input against a real Fuseki.

**Alternative:** parameterised queries: SPARQL over HTTP has none. `rdflib` is added as a development dependency only, for the parser.

### 2. Hint shape

`{hint_type: "enum" | "range" | "datatype" | "none", values, minimum, maximum, minimum_exclusive, maximum_exclusive, datatype, detail}`. Values and limits from several matching shapes are combined: the union of values, the narrowest limits. `detail` says why there are no hints when Fuseki can't answer, and the answer is still 200, since hints only help.

`getValueHints` changes from a list to this object, in the mock too. **Alternative:** keep the list and add an operation for ranges: two requests for one thing.

### 3. Read functions

In the agent package (`FusekiOntologySource`), for #29: `query(sparql)`, `shapes(entity_type)` and `knowledge(entity_type)`. They answer `{"ok": true, ...}` or `{"ok": false, "error": ...}` and never raise for a failing service. `query` accepts SELECT, ASK, CONSTRUCT and DESCRIBE, refuses updates and `SERVICE`, and caps results at 1000 rows and the answer at 5 MB. No HTTP route exposes it.

### 4. Graph base

From `FUSEKI_GRAPH_BASE`, checked at startup to be an IRI that is safe to place in a query.

## Risks and limits

- **Fuseki version.** The platform builds its own image on Fuseki 6.1.0, which isn't published where it could be pulled. The local environment uses the public `stain/jena-fuseki:5.1.0` image, which asks for its admin password to write, so the sample loader takes it from `FUSEKI_ADMIN_PASSWORD`. Tests pass on both.
- **Hints are advice.** The explorer doesn't refuse a value outside them. The platform's rules report those as alerts.
