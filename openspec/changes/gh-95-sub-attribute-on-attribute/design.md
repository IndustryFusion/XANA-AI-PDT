# Design

## Context

See proposal.md, Why. The explorer API has two ways to add a sub-attribute today:

- **To the attribute itself:** an update whose fragment holds the new sub-attribute. The backend completes it
  with the attribute's type and value and sends it to the broker's entity-level merge.
- **At a path below the attribute:** `name` and one `path` parameter per level. The backend reads the
  attribute, adds the sub-attribute at that level and writes the instance back whole with the attribute-level
  update. Its `datasetId` says which instance.

The first depends on the broker's merge; on the platform's Scorpio v0.7.0 it stores the merge result object.

## Goals / Non-Goals

**Goals:** a sub-attribute added to an attribute is stored correctly whatever the broker's merge does, with
the same checks as at a path (`conflict` for an existing name, a sub-attribute needs a type).

**Non-Goals:** changing updates of existing values, or the layout of the explorer (see proposal.md, Out of Scope).

## Decisions

### D1: The add route takes `name` without a path

Adding with `name` and no `path` adds the body's sub-attributes to that attribute itself, through the same
read-and-write-back as at a path, with an empty path. Without `name`, the route adds attributes as before.

- *Alternative: keep the merge and complete the fragment differently.* Rejected: the result object comes from
  the broker's merge whatever the fragment holds, and it can't be detected from the answer, which is 204.
- *Alternative: a new route for sub-attributes.* Rejected: the route already takes `name` and `path` for
  adding at a path; an empty path is the same operation one level up.

### D2: The explorer uses that route for every add of a sub-attribute

The add form sends a sub-attribute with the attribute's name and its path, which is empty for the attribute
itself, instead of choosing between an update and an add. The mock data source follows the same contract, so
the explorer's tests exercise it.

### D3: Updates that bring a new sub-attribute are written back whole

An update whose fragment names a sub-attribute the attribute doesn't have yet is merged into the attribute as
read and written back whole with the attribute-level update. Updates that only change existing members keep
the merge, which every supported broker handles.

- *Alternative: always write back whole.* Rejected: the merge is what keeps an update from overwriting members
  changed by others since the read, and it is correct where no new sub-attribute is involved.

### D4: A write of a whole attribute arms the delivery check

The backend arms its live-update delivery check after writes the broker notifies. A write of a whole attribute
by its name (`/entities/{id}/attrs/{name}`) is such a write; it now counts, so a stalled notification path is
noticed after it as after a merge.

## Risks / Trade-offs

- **The whole instance is written back.** A change by someone else to the same attribute between the read and
  the write is lost. That is already so for every add, change and delete at a path. The backend serialises
  its own edits of an entity.
- **The fake broker merges correctly**, so unit tests alone don't show the defect. The real-broker test
  covers the route and is run against the platform's broker as well as in CI.
