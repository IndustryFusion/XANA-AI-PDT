# Design

## Context

`get_llm()` builds the model from settings, and `ask()` in the agent package makes every structured call. Both exist, so this change extends them. `architecture.md` says model calls use one retry, which changes here.

## Goals / Non-Goals

**Goals:**

- A run works on Ollama, on OpenVINO Model Server and on a cloud provider by changing only configuration.
- Operators see which model is in use and whether it is available.

**Non-Goals:**

- Selecting a model at runtime.

## Decisions

**Ollama gets its schema through its `format` option.** A small adapter in the agent package binds the answer's JSON schema, with references inlined, and reads the answer from the content or from the first tool call. Some local models answer through tool calls even when given a format. Alternative: the framework's `with_structured_output`, kept for other providers; on Ollama it handles only one of those answer forms.

**Reasoning off on Ollama.** Thinking output is not part of the answer, and it costs time. Alternative: keeping it on and stripping it, which adds work with no benefit to the structure.

**Context size from `LLM_NUM_CTX`, default 32768.** Ollama's own default is small enough to cut off the prompts this workflow sends. Alternative: letting Ollama's model configuration decide, which would need setup on every server.

**Up to three retries, then the round fails.** Local models give malformed answers more often than cloud models, and a retry is cheap next to losing the round. Alternative: keeping one retry, which fails too often on local models.

**OpenAI-compatible servers get the schema in the prompt.** With a base address, the schema is added to the prompt, and the answer is read from the content. OpenVINO Model Server 2026.2.1 on CPU exited with a segmentation fault on `response_format: json_schema` when tested. Alternative: a setting to choose between native and prompt, which would make the default crash that server, or leave cloud-compatible services to choose; a wrong answer is retried either way.

**OpenAI-compatible servers need no API key.** With `OPENAI_BASE_URL` set, `OPENAI_API_KEY` is optional, because OpenVINO Model Server has no key. Servers that do need a key answer 401, and health reports it. Without a base URL, the key stays required. Alternative: requiring a placeholder key, which puts a fake secret in every OpenVINO Model Server deployment.

**Readiness reuses the health check's model probe.** It lists the models with the health timeout, and spends no tokens. Alternative: a one-token model call, which is closer to a real call but costs money on cloud providers and can take long while a local model loads. A model that loads slowly or fails mid-call is still handled by the round's own failure handling.

**Readiness applies where a new round starts:** start, clarify, a rejected resolution and reopening an incident. Confirming a resolution does not call the model, so it is not checked.

**The model list is part of the health report.** `models: [{name, role, available}]` follows the language model check. `role` is `agent`, because the agent is the only model user. Alternative: a separate route, which would mean a second request for one screen.

**Tracing through a callback, optional at two levels.** `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` turn it on, and the `tracing` extra installs it. If keys are set and the package is missing, the backend logs a warning and runs without tracing, because tracing must never stop a diagnosis. Runs are traced with the run ID as session and the machine and round as metadata. Alternative: a required dependency, which the issue excludes.

**A model list that can't be read doesn't stop work.** An OpenAI-compatible server need not offer `/models`, and a cloud list can be slow. A 404, 405 or 501, or a read timeout, shows the check as degraded, saying the model could not be confirmed, and work may still start. A server that can't be reached, an authentication error, a server error, or a list without the configured model still gives 503. Alternative: treating these as unavailable, which blocks every run on a server that can answer. Limit: the Anthropic check doesn't search the list, which is paged and leaves out aliases, so a wrong `LLM_MODEL` shows when the first request fails.

**Reasoning and broken content don't waste a retry.** `<think>` text is removed before reading the answer, and a broken object in the content doesn't hide a valid tool call.

## Architectural implications

No conflict with `architecture.md` beyond the retry count and the variables, which this change updates. The workflow stays read-only towards the factory, and the agent package gains no dependency on the service.

## Risks / Trade-offs

- [The readiness probe can pass while the model then fails] → The round fails with a readable reason, as it does today.
- [A prompt-based answer can be malformed more often on a small model] → Retries handle it, and the round fails with a readable reason if they are used up.
- [Thirty-two thousand tokens of context needs memory on the Ollama server] → `LLM_NUM_CTX` can be lowered.
- [Langfuse's API may change] → Tests use a stand-in. Tracing failures are caught and logged.

## Open Questions

None.
