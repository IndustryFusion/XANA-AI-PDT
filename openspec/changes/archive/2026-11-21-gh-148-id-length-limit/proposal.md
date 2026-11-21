# Proposal

Issue: #148

## Why

`POST /api/ngsi/entities-by-id` and `POST /api/ngsi/attr-status-by-id` (added in #141) accept up to 1,000 IDs per request, but nothing bounds the length of a single ID. A request can therefore carry IDs of any size, which the backend puts into broker queries and time-series filters. Noted in the review of #141: https://github.com/IndustryFusion/XANA-AI-PDT/pull/141#pullrequestreview-5991942868, note 4.

## What Changes

- Both endpoints refuse an ID longer than 2,048 characters as invalid (422), before anything is sent to the broker or the time series, as they refuse more than 1,000 IDs.

## Capabilities

### New Capabilities

### Modified Capabilities
- `backend/explorer-api`: **Many entities at once** — at most 2,048 characters per ID.

## Out of Scope

- Checking that an ID is a URI; the broker refuses such IDs, and a read of many reads a refused list again one by one.
- Bounding the length of IDs elsewhere in the API, such as the single reads by ID.
- Frontend changes.

## Impact

- `backend/app/api/ngsi.py`: the model of the IDs of both endpoints.
- No frontend change: the explorer reads only the IDs of entities it shows, which are far shorter.
- Affected section of architecture.md: none; the bound narrows only the existing endpoints for many entities.
