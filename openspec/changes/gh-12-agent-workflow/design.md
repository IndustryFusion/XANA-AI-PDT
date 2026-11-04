# Design

## Context

See proposal.md → Why. `gh-12-backend-foundation` creates the empty `xana-agent` package (`backend/agent/xana_agent/`), the settings, `get_llm()` with the scripted provider, and the time-series layout decision (attribute history table).

`architecture.md` → Agent Runtime describes a LangGraph `StateGraph` with typed Pydantic outputs, confidence normalisation, routing on `awaiting_input` and graceful degradation. Phase 1 uses the five-step sequence of `manifest.md` → Agent Runtime.

The UI renders step content with fixed field names (`frontend/docs/data-interface.md` and the run view). This change produces exactly those fields, so `gh-12-run-api` can pass steps through unchanged, apart from the snake_case to camelCase mapping in the adapter.

## Goals / Non-Goals

**Goals:**
- A workflow that is deterministic in structure, typed in content, and testable without a model or services.
- The same step content as the UI's mock, so the UI needs no change.

**Non-Goals:**
- Run lifecycle, persistence and streaming to clients (`gh-12-run-api`).
- Alerts in OBSERVE, escalation and conversation (later phases).

## Decisions

### 1. Package structure
```
xana_agent/
  __init__.py        public API: Workflow, RoundInput, StepEvent, Outcome, sources
  workflow.py        graph construction and the public run functions
  state.py           AgentState (TypedDict)
  schemas.py         Pydantic models for model answers, with confidence normaliser
  steps/             observe.py, hypothesize.py, validate.py, decide.py, act.py
  prompts/           one text template per step
  sources/
    base.py          protocols: ContextSource, HistorySource, IncidentMemory
    ngsi.py          ContextSource over NGSI-LD HTTP
    timescale.py     HistorySource over the attribute history table
    memory.py        InMemoryIncidentMemory (tests, standalone use)
  testing.py         fake sources and scripted answers for tests
```
The package does not import the service (`app`). A test enforces this.

### 2. Public API
```python
wf = Workflow(llm=..., context=..., history=..., memory=..., threshold=0.9)
async for event in wf.analyse(RoundInput(machine_id, issue, round=1,
                                         clarifications=[...], rejected=[...])):
    ...  # StepEvent(node, input, output, at) ... then Outcome
async for event in wf.act(RoundInput(...), decision, trace):
    ...  # StepEvent('act', ...) then Outcome
```
`Outcome.kind` is one of:
- `awaiting_input`, with question, confidence and threshold;
- `awaiting_confirmation`, with root cause, recommended action and confidence;
- `completed`, with incident id;
- `failed`, with node and error.

The caller (the service in `gh-12-run-api`) owns run state between rounds. The package is stateless across rounds, so a paused run needs no in-process graph state and survives a restart.

*Alternative:* a LangGraph checkpointer that pauses inside the graph (interrupts). It needs a checkpoint store and ties run persistence to LangGraph's format; re-entering with explicit input is simpler and matches `architecture.md` ("the full graph re-runs from observe").

### 3. Graph
```
analyse: observe → hypothesize → validate → decide → END
act:     act → END
```
These are two compiled graphs over the same `AgentState`. `decide` sets the outcome; there is no conditional edge into ACT. Confirmation is an operator action between calls, which makes "ACT only after confirmation" structural rather than a flag. Events come from `astream(stream_mode="updates")`; each node returns its step record.

*Alternative:* one graph with a conditional edge `decide → act` guarded by `resolution_confirmed`. It is equivalent, but a bug in the guard could log an unconfirmed diagnosis.

### 4. Step content (matches the UI)

| Node | input | output |
|---|---|---|
| `observe` | `{machine_id, issue}` | `{summary, signals: [{name, value, unit, assessment}], sources: [{source, status, detail}], partial_data, entities: [id]}` |
| `hypothesize` | `{observations}`, or `{clarification}` or `{rejected_root_causes, reason}` | `{hypotheses: [{id, title, confidence, evidence}]}` |
| `validate` | `{hypotheses: [id], checks: [...]}` | `{hypotheses: [{id, title, confidence, evidence, verdict, validation}]}` |
| `decide` | `{threshold}` | `{root_cause, recommended_action, confidence, threshold, question?, past_incidents: [...]}` (`root_cause` and `recommended_action` are null when below the threshold) |
| `act` | `{decision}` | `{action, recommended_action, incident_logged: true, incident_id}` |

- Hypothesis ids are `h<round>-<n>`.
- `assessment` is computed, not generated: the trend over the window (`rising`, `falling`, `stable`), or `no history`.

### 5. Observe
- **Entities:**
  - get the machine;
  - follow its Relationship attributes one level deep (`architecture.md` → `ngsi_traverse_relationships`);
  - keep the machine and the related entities, at most 20 in total.
- **History:** `HistorySource.recent(entity_ids, window)` returns the last value and the trend per numeric attribute (default window 24 h, configurable).
- **Source errors** are caught per source and recorded in `sources`, with `partial_data = true`.

### 6. Validate
1. The model answers with a `ValidationPlan`: history queries `(entity_id, attribute, window, bucket)` and entity lookups `(entity_id)`, each tied to a hypothesis.
2. The plan is trimmed to 6 queries and 3 lookups. Any entity id that was not observed in this round is dropped, which keeps the workflow on the run's machine.
3. The queries run as `time_bucket` aggregates (min, max, avg, last).
4. A second model call with the results returns `ValidatedHypothesisList`.

### 7. Decide
- **Past incidents:** `IncidentMemory.similar(machine_id, machine_type, limit=3)` returns completed incidents of the same machine first, then of the same type.
- **Confidence:** the maximum validated confidence. The model's own confidence is not used for gating, so the number shown and the number used for routing are always the same (`architecture.md` → Confidence-gated decisions).
- **Below the threshold:** a model call produces the question naming the missing information.
- **At or above the threshold:** a model call produces `Decision`: root cause, recommended action and reasoning. The root cause is constrained to the validated hypotheses that were not rejected. If the model names a rejected one, the next-best validated hypothesis is used.

### 8. Model calls
- All model calls use `with_structured_output(Model)`, a timeout of `LLM_TIMEOUT_S`, and one retry when the answer does not validate.
- Confidence fields share the normaliser: >1 is read as a percentage, then clamped to [0, 1].
- Prompts put operator text (issue, clarifications, rejection reasons) in delimited data sections, with an instruction to treat them as data. Combined with decision 6, this keeps reads on the run's own entities and no write path exists.

### 9. Memory interface
```python
class IncidentMemory(Protocol):
    async def similar(self, machine_id, machine_type, limit) -> list[PastIncident]
    async def store(self, record: IncidentRecord) -> str   # returns incident id
```
The package ships an in-memory implementation. The PostgreSQL implementation lives in the service (`gh-12-run-api`), which owns the schema.

*Alternative:* the PostgreSQL implementation in the package. That would put schema ownership in two places.

### 10. Tests
- **Scripted answers per step** (`testing.py`) drive the five behaviours: confident, low, clarified, rejected and model failure.
- **Fake sources** can be set to raise errors.
- **Network blocking:** a fixture blocks network access in all package tests.
- **Integration tests** (`db` marker) cover the TimescaleDB history source against the sample data layout.

## Risks / Trade-offs

- **Small local models:** they may produce malformed structured answers more often. Mitigation: one retry, then a clear failure, and the provider can be switched.
- **Re-observing on every round costs time:** accepted, because the data may have changed after a clarification.
- **Confidence from the model's self-assessment:** it is not calibrated. This is known and documented; the threshold is configurable.
