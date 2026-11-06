# xana-agent — diagnostic agent workflow

The diagnostic agent of XANA AI PDT as a package of its own. It does not need the backend service: a program gives it a machine, an issue, a language model and its data sources, and receives every step as it completes. The backend service is one such program.

One analysis round runs `observe → hypothesize → validate → decide` and ends:
- **waiting for input**, with a question, when the confidence is below the threshold;
- **waiting for confirmation** of a root cause and a recommended action otherwise.

After the operator confirms, `act` logs the incident in incident memory. A clarification or a rejected resolution starts the next round. See [`architecture.md`](../../architecture.md) → Agent Runtime.

## Install

```bash
pip install -e "backend/agent"                    # Ollama support included
pip install -e "backend/agent[anthropic,openai]"  # cloud providers as well
```

## Use

This example runs without a model or services: the scripted model and the in-memory sources from `xana_agent.testing`.

```python
import asyncio

from xana_agent import InMemoryIncidentMemory, Outcome, RoundInput, ScriptedChatModel, Workflow
from xana_agent.testing import MACHINE_ID, FakeContextSource, FakeHistorySource, sample_entities, sample_history


async def main():
    workflow = Workflow(
        llm=ScriptedChatModel(),
        context=FakeContextSource(sample_entities()),
        history=FakeHistorySource(sample_history()),
        memory=InMemoryIncidentMemory(),
        threshold=0.9,
    )
    round_input = RoundInput(machine_id=MACHINE_ID, issue="Oil temperature keeps rising.")
    trace = []
    async for event in workflow.analyse(round_input):
        if isinstance(event, Outcome):
            outcome = event
        else:
            trace.append(event.as_dict())
            print(event.node, event.output.get("summary") or "")
    print(outcome.kind, outcome.root_cause, outcome.confidence)

    # The operator confirms the proposed resolution.
    async for event in workflow.act(round_input, outcome.decision, trace):
        if isinstance(event, Outcome):
            print(event.kind, event.incident_id)


asyncio.run(main())
```

With real data and a model, use the sources for the context broker and the attribute history table, and any LangChain chat model:

```python
from langchain_ollama import ChatOllama
from xana_agent import NgsiContextSource, TimescaleHistorySource

workflow = Workflow(
    llm=ChatOllama(model="llama3.1", base_url="http://localhost:11434"),
    context=NgsiContextSource("http://localhost:9090", tenant=None),
    history=TimescaleHistorySource("postgresql://xana@localhost:5432/tsdb", table="attributes"),
    memory=InMemoryIncidentMemory(),
)
```

## Contents

```
xana_agent/
  workflow.py        Workflow: the two graphs (analyse, act) and their event streams
  schemas.py         model answers, round input, StepEvent, Outcome; confidence normaliser
  state.py           AgentState
  steps/             observe, hypothesize, validate, decide, act; model calls with timeout and retry
  prompts/           one template per model call
  sources/           ContextSource, HistorySource, IncidentMemory and their implementations
  scripted.py        ScriptedChatModel: fixed answers, no model
  testing.py         fake sources, scripted step answers, a small sample machine
```

## Behaviour worth knowing

- **Read-only.** The context source sends only GET requests; the history source runs read-only transactions. Validation checks are limited to the entities observed in the round, so text in an issue cannot widen what is read.
- **Degradation.** An unreachable context broker, time-series store or incident memory is reported in the step (`sources`, `partial_data`); the round goes on with the data it has.
- **Model failure.** A model call that times out (`llm_timeout_s`), or keeps answering with content that does not match the expected structure on the first try and three retries, fails the round with the step and a readable reason.
- **Stateless.** Nothing is kept between calls. The caller passes the round number, the clarifications and the rejected root causes with their reasons.

## Tests

```bash
cd backend
.venv/bin/pytest agent/tests
```

Tests run without network access and without a model. The history source tests marked `db` need `TEST_DATABASE_URL` (see [`backend/README.md`](../README.md)).
