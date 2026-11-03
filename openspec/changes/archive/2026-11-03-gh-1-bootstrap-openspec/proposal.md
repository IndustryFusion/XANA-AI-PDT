# Proposal

Issue: #1

## Why

Contributors should be able to propose features as GitHub Issues while AI coding
agents refine specifications, plan, implement and verify under maintainer
governance. Today the repository has no specification workflow, no agent
instructions and no CI, so requirements, architectural decisions and
implementation are not traceable to each other.

## What Changes

- Initialize OpenSpec (default `spec-driven` schema) with `openspec/specs/` as
  the authoritative specification location and `openspec/changes/` for change
  proposals. `openspec/specs/` starts empty.
- Add project context and artifact rules in `openspec/config.yaml`, derived
  from `manifest.md` and `architecture.md`.
- Add agent-independent instructions (`AGENTS.md`) and a pointer for Claude
  Code (`CLAUDE.md`); commit the native OpenSpec skills and commands generated
  for Claude Code.
- Define the lifecycle Issue → Proposal → Spec review → Implementation plan →
  Implementation → Verification → Merge → Archive, with a `spec-approved` PR
  label gating implementation.
- Define traceability: change IDs `gh-<issue>-<kebab-summary>` and an
  `Issue: #N` line in every proposal.
- Add a GitHub Actions workflow validating OpenSpec artifacts, a feature issue
  form, a PR template and a contributor guide.

## Capabilities

### New Capabilities
- `spec-driven-workflow`: How changes to this repository are proposed,
  specified, approved, implemented, verified and archived, and how they stay
  traceable to GitHub Issues and Pull Requests.

### Modified Capabilities

None.

## Impact

- New files only: `openspec/`, `AGENTS.md`, `CLAUDE.md`, `CONTRIBUTING.md`,
  `.claude/`, `.github/`. `README.md` gains a link to the contributor guide.
- No application code or runtime dependency is added; the CI job downloads a
  pinned, checksum-verified OpenSpec binary.
- No existing CI exists, so no existing workflow is affected.

## Out of Scope

- Autonomous issue-to-merge execution and multi-agent orchestration.
- Custom agent frameworks or orchestration servers.
- Automatic approval of specifications or architectural changes.
- Enforcing who may apply the `spec-approved` label (CODEOWNERS, branch
  protection); this needs repository admin settings and remains open.
- Code-level testing and lint conventions; deferred until the application code
  and `architecture.md` are updated.
- Any change to application behavior.
