# Contributing

XANA AI PDT uses specification-driven development with
[OpenSpec](https://github.com/Fission-AI/OpenSpec). Every change is specified
and approved before it is implemented, and every change is traceable from its
GitHub Issue to its Pull Request and archived specification.

## Lifecycle

| # | Step | Who | Automated? |
|---|---|---|---|
| 1 | Open a feature issue | Contributor | Manual |
| 2 | Create the OpenSpec change proposal | Agent, started by a maintainer | Agent-assisted |
| 3 | Review the specification | Maintainers | Manual |
| 4 | Approve: add the `spec-approved` label | Maintainer | Manual |
| 5 | Plan and implement the tasks | Agent, started by a maintainer | Agent-assisted |
| 6 | Verify | CI + maintainers | Partly: CI validates artifacts; humans review behavior |
| 7 | Merge | Maintainer | Manual |
| 8 | Archive the change | Agent or maintainer | Agent-assisted (`/opsx:archive`) |

### 1. Propose a feature

Open an issue with the **Feature request** form. Describe the problem, the
desired outcome and, if you can, how to tell that it works. You do not need to
write code or install OpenSpec.

### 2. Create the change proposal

A maintainer asks a coding agent to create a proposal from the issue, for
example in Claude Code:

```
/opsx:propose Issue #42
```

The agent follows [AGENTS.md](AGENTS.md). It creates
`openspec/changes/gh-42-<summary>/` containing:

- `proposal.md`: why, what changes, out of scope; starts with `Issue: #42`
- `specs/<capability>/spec.md`: requirements, each with WHEN/THEN scenarios that serve as acceptance criteria
- `design.md`: architectural implications, decisions and alternatives
- `tasks.md`: implementation checklist, each task with its verification

The agent opens a Pull Request containing only the proposal.

### 3–4. Review and approve

Maintainers review the proposal in the Pull Request like any other document:
inline comments, requested changes, revisions (`/opsx:update`). When the
specification is accepted, a maintainer adds the **`spec-approved`** label.
Agents must not implement before the label is present.

### 5. Implement

A maintainer asks the agent to continue on the same Pull Request:

```
/opsx:apply gh-42-<summary>
```

The agent works through `tasks.md`, adds or updates tests, and keeps
implementation commits separate from specification commits. It must not
change approved requirements; if one cannot be met, it stops and the
specification goes back to review.

### 6. Verify

- **Automated:** the `OpenSpec validate` workflow runs
  `openspec validate --all --strict` on every Pull Request touching
  `openspec/`. It checks the structure of artifacts (for example, that every
  requirement has a scenario), not whether the code is correct.
- **Human review:** maintainers check that each spec scenario is met, that
  tests cover them, and that security and data-sharing constraints hold. The
  Pull Request lists verification results per scenario.

### 7–8. Merge and archive

After merge, run `/opsx:archive gh-42-<summary>` (or `openspec archive`) in a
follow-up Pull Request. This merges the delta specs into `openspec/specs/`,
which is the authoritative description of the system, and moves the change to
`openspec/changes/archive/`, preserving its history.

## Conventions

- **Change ID:** `gh-<issue>-<kebab-summary>`.
- **Proposal:** `Issue: #<number>` as its first line.
- **Pull Request:** names the change ID and closes the issue (template provided).

## Working locally (optional)

Only maintainers or contributors driving an agent need OpenSpec locally:

```bash
curl -fsSL https://openspec.dev/cli/install.sh | sh   # or: npm install -g @fission-ai/openspec
openspec list            # in-flight changes
openspec list --specs    # approved capabilities
openspec validate --all --strict
```

## Supported agents

All agents read [AGENTS.md](AGENTS.md). Claude Code is the starting point and
has native OpenSpec skills and `/opsx:*` commands in `.claude/`. To add native
support for another agent, run for example:

```bash
openspec init --tools cursor,github-copilot,codex
```

and commit the generated files. `openspec init --help` lists all tool IDs.

## Current limitations

- Proposal creation, implementation and archiving are started manually by a maintainer; nothing runs automatically from issues.
- Who may add `spec-approved` is not enforced yet (CODEOWNERS / branch protection are open decisions).
- CI checks artifact structure only. Functional correctness and security require human review.
- Code-level test and lint conventions are not defined yet; they follow once the application code is in the repository.
