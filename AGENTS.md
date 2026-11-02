# Agent Instructions

These instructions apply to every AI coding agent working in this repository.
The project uses [OpenSpec](https://github.com/Fission-AI/OpenSpec) for
specification-driven development. The human-facing version of this workflow is
in [CONTRIBUTING.md](CONTRIBUTING.md).

## Project context

- Purpose and target architecture: [manifest.md](manifest.md),
  [architecture.md](architecture.md).
- `architecture.md` describes the target system. The code it mentions is not
  necessarily in this repository yet; check before assuming it exists.
- OpenSpec project context and artifact rules: `openspec/config.yaml`.

## Lifecycle

GitHub Issue → Change proposal → Specification review → Implementation plan →
Implementation → Verification → Merge → Archive

1. **Propose.** Given a GitHub Issue, create a change with `/opsx:propose`
   (or the `openspec-propose` skill, or `openspec new change`).
   - Change ID: `gh-<issue>-<kebab-summary>`, e.g. `gh-42-add-alert-filtering`.
   - First line of `proposal.md` after the title: `Issue: #<number>`.
2. **Inspect existing specs first.** Run `openspec list --specs` and read
   related specs with `openspec show <spec-id> --type spec`. Reuse existing
   capabilities instead of creating near-duplicates.
3. **Report architectural conflicts.** If the issue conflicts with
   `architecture.md` or an existing spec, state it in `design.md` and in the
   Pull Request. Do not resolve it silently; present alternatives.
4. **Open the Pull Request with the proposal only** (`openspec/changes/<id>/`).
   Run `openspec validate <id> --strict` before pushing.
5. **Wait for approval.** Do not change source code until a maintainer has
   added the `spec-approved` label to the Pull Request. If it is missing, say
   that approval is pending and stop.
6. **Implement** with `/opsx:apply` in the same Pull Request, working through
   `tasks.md` and ticking tasks as they are verified.
   - Create or update tests that cover the spec scenarios.
   - Never change approved requirements to fit the implementation. If a
     requirement cannot be met as written, stop, describe the conflict, and
     change the spec only after maintainer agreement.
7. **Verify.** Check every scenario in the change's delta specs against the
   implementation and report the result per scenario in the Pull Request.
   Passing CI does not prove functional correctness or security.
8. **Archive** after merge with `/opsx:archive <id>` in a follow-up Pull Request.

## Rules

- Keep specification commits and implementation commits separate.
- Every Pull Request names its change ID and references its issue.
- Do not add runtime dependencies or infrastructure that the approved spec and
  design do not call for.
- Do not invent architectural rules or test conventions that are not in
  `architecture.md`, `openspec/config.yaml` or an approved spec.
