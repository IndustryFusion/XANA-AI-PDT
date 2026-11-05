Machine:
<machine>
{machine}
</machine>

Issue:
<issue>
{issue}
</issue>

Hypotheses:
<hypotheses>
{hypotheses}
</hypotheses>

Entities you may check (only these):
<entities>
{entities}
</entities>

Signals with history:
<signals>
{signals}
</signals>

Plan targeted checks that would confirm or refute each hypothesis:
- queries: an attribute history query (entity ID, attribute, window in hours, aggregation interval in minutes);
- lookups: a fresh read of an entity's current values.
Tie each check to a hypothesis ID. Use at most {max_queries} queries and {max_lookups} lookups, and only the entities listed.
