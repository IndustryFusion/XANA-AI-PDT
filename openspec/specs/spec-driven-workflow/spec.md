# spec-driven-workflow Specification

## Purpose
Defines how changes to XANA AI PDT move from a GitHub Issue through an OpenSpec
change proposal, maintainer approval, implementation and verification to an
archived specification, while staying traceable throughout.

## Requirements

### Requirement: Change originates from a GitHub Issue
Every OpenSpec change SHALL reference exactly one originating GitHub Issue with an `Issue: #<number>` line in its `proposal.md`.

#### Scenario: Proposal references its issue
- **WHEN** a change proposal is created for GitHub Issue 42
- **THEN** its `proposal.md` contains the line `Issue: #42`

### Requirement: Stable change identifiers
Every change directory under `openspec/changes/` SHALL be named `gh-<issue>-<kebab-summary>`, where `<issue>` is the originating issue number and `<kebab-summary>` is a short kebab-case description.

#### Scenario: Change ID follows the convention
- **WHEN** a change is proposed for issue 42 about adding alert filtering
- **THEN** the change directory is `openspec/changes/gh-42-add-alert-filtering/`

### Requirement: Proposal completeness
A change proposal SHALL contain a proposal with motivation and out-of-scope items, delta specifications whose requirements each have at least one WHEN/THEN scenario, a design covering architectural implications, and a task list with a verification step per task.

#### Scenario: Complete proposal passes strict validation
- **WHEN** `openspec validate <change-id> --strict` runs on a complete proposal
- **THEN** validation succeeds

#### Scenario: Requirement without scenario is rejected
- **WHEN** a delta specification contains a requirement with no scenario
- **THEN** `openspec validate <change-id> --strict` fails

### Requirement: Specification approval gates implementation
Implementation of a change SHALL start only after a maintainer has added the `spec-approved` label to the Pull Request that contains the change proposal.

#### Scenario: Agent waits for approval
- **WHEN** an agent is asked to implement a change whose Pull Request lacks the `spec-approved` label
- **THEN** the agent does not modify source code and reports that specification approval is pending

#### Scenario: Agent implements after approval
- **WHEN** the Pull Request carries the `spec-approved` label
- **THEN** the agent implements the change's tasks in the same Pull Request

### Requirement: Approved requirements are authoritative
Implementation SHALL NOT change approved requirements. When implementation reveals that a requirement must change, the agent SHALL stop and propose the specification change for maintainer review.

#### Scenario: Conflict found during implementation
- **WHEN** an agent finds during implementation that an approved requirement cannot be met as written
- **THEN** the agent stops, describes the conflict, and edits the specification only after maintainer agreement

### Requirement: Pull Requests reference their change
Every Pull Request that contains an OpenSpec change SHALL name the change ID and link the originating issue.

#### Scenario: PR description links change and issue
- **WHEN** a Pull Request for change `gh-42-add-alert-filtering` is opened
- **THEN** its description names `gh-42-add-alert-filtering` and references issue 42

### Requirement: Automated artifact validation
Every Pull Request that modifies files under `openspec/` SHALL run `openspec validate --all --strict` in CI, and a validation failure SHALL fail the check.

#### Scenario: Malformed change fails CI
- **WHEN** a Pull Request adds a delta specification with a scenario using three hashes instead of four
- **THEN** the OpenSpec validation check fails

#### Scenario: Unrelated change does not run the check
- **WHEN** a Pull Request modifies no files under `openspec/` and not the validation workflow
- **THEN** the OpenSpec validation check is not triggered

### Requirement: Archived history remains accessible
After a change is merged, it SHALL be archived with OpenSpec, which merges its delta specifications into `openspec/specs/` and keeps the proposal, design and tasks under `openspec/changes/archive/`.

#### Scenario: Archive preserves history
- **WHEN** a merged change is archived
- **THEN** its requirements appear in `openspec/specs/` and its original artifacts are found under `openspec/changes/archive/`

### Requirement: Discoverable agent instructions
The repository SHALL provide agent-independent instructions in `AGENTS.md` describing the lifecycle, and each supported agent SHALL be able to reach them from its native instruction mechanism.

#### Scenario: Claude Code discovers the workflow
- **WHEN** Claude Code starts in the repository
- **THEN** `CLAUDE.md` directs it to `AGENTS.md` and the OpenSpec `/opsx:*` commands are available

### Requirement: Contributor guide states automation boundaries
The repository SHALL provide a contributor guide that explains each lifecycle step and states for each step whether it is automated or requires manual action.

#### Scenario: Contributor without local tooling
- **WHEN** a contributor without OpenSpec installed wants to propose a feature
- **THEN** the guide explains how to do so by opening a GitHub Issue only
