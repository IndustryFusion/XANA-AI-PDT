# Design

## Context

`backend/service-runtime` "Optional tracing" traces model calls when both Langfuse keys are set, and the backend passes `LANGFUSE_HOST` to the Langfuse client. The chart passes the keys as secrets (`XANA_LANGFUSE_PUBLIC_KEY`, `XANA_LANGFUSE_SECRET_KEY`) and no address. There is no conflict with `architecture.md` or the specs.

## Decisions

### Two names for one setting

`LANGFUSE_HOST` and `LANGFUSE_BASE_URL` both set the address. One set: it's used. Both set and equal: fine. Both set and different: the backend stops at startup naming both variables, as it does for other invalid settings, so it never sends traces to an address the operator didn't mean.

Alternative: one name wins silently. With traces holding run data, going to the wrong server without a word is the failure this issue is about.

### The address is configuration, not a secret

It goes into the backend's ConfigMap, from the `XANA_LANGFUSE_HOST` environment variable in Helmfile or the chart value, like `GATEWAY_URL`. It's shown masked wherever addresses are shown. Unset, nothing is rendered and the backend's default applies.

### No keys, no traces

The tracing client is created only with both keys. An address alone creates nothing and opens no connection; a test with a stand-in server checks that it gets no request.

## Risks

- Traces hold prompts and model answers about the plant. An operator choosing their own server is the point; the chart now makes the default visible in its README.
