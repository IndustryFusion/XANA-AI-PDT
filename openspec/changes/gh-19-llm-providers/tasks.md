# Tasks

## 1. Settings and model creation

- [x] 1.1 Add `LLM_NUM_CTX`, `LLM_PROVIDER_NAME` and the `LANGFUSE_*` settings to the configuration and `.env.example`; verify with config tests, including invalid values
- [x] 1.2 Pass the context size and reasoning-off to Ollama; verify with a test on the created model
- [x] 1.3 Make `OPENAI_API_KEY` optional when `OPENAI_BASE_URL` is set; verify with config tests in both cases

## 2. Structured answers

- [x] 2.1 Add the Ollama adapter: schema as format, answers from content or tool calls; verify with unit tests for each answer form and for inlined references
- [x] 2.2 Retry a malformed answer up to three times, then fail with the step and a reason; verify with workflow tests for success on the last retry and for final failure

## 3. Health and readiness

- [x] 3.1 Add `models` and the display name to the health report; verify with health tests for each provider
- [x] 3.2 Make the health check work against OpenAI-compatible servers without a key; verify against a real OpenVINO Model Server
- [x] 3.3 Refuse start, clarify, rejection and incident reopen with 503 when the model is unavailable; verify with run API tests, and against a stopped Ollama
- [x] 3.4 Show the model list on the System screen, on both data sources; verify with component tests and the data interface test

## 4. Tracing

- [x] 4.1 Add optional tracing with run metadata; verify with a stand-in package that the callback gets the run ID, and that the app starts with keys set and the package missing

## 5. Documents

- [x] 5.1 Update `backend/README.md`, `architecture.md`, `frontend/docs/data-interface.md` and `compose.yaml`; verify by searching for each new variable

## 6. Verification against real providers

- [x] 6.1 Complete a diagnostic run against Ollama; verify a run reaches a waiting or final state, and record the model
- [x] 6.2 Complete a diagnostic run against OpenVINO Model Server; verify the same, and record the model
- [ ] 6.3 Complete a diagnostic run against one cloud provider; verify the same, and record the model
- [x] 6.4 Send a prompt longer than Ollama's default context; verify the reported prompt token count shows it was not cut off

## 7. Integration check

- [x] 7.1 Run backend and frontend tests, lint and `openspec validate --all --strict`; verify they pass locally and in CI
- [x] 7.2 Check each scenario in the delta specs and report the result per scenario in the Pull Request; verify the report covers every scenario

## Workflow follow-up

- After merge, run `/opsx:archive gh-19-llm-providers` in a follow-up Pull Request from a fork, with `Closes #19` in its description.
