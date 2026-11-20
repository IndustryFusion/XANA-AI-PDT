# Design

## Context

- The Alerts area shows the list and, beside it, the detail of the alert the address names. The list is read with the filter's request and refreshed at the interval the operator chose (`refreshMs`), and again after an action or *Refresh now* (`refreshKey`).
- The detail reads its alert by ID on its own and only follows `refreshKey`, so between actions it shows the alert as it was when it was opened.
- Alerta's statuses are `open`, `ack`, `shelved`, `closed` and `expired`. A clear closes an alert. The default filter lists `open` and `ack`; *Closed* and *All* list closed alerts.
- The detail is also opened by links from outside the area, for example from an incident's steps, and those can name an alert that has already ended.

## Goals / Non-Goals

**Goals:** an alert that ends while its detail is shown takes its detail with it; the detail shows the current state of its alert.

**Non-Goals:** closing the detail when the alert leaves the list for other reasons; push updates from Alerta; backend changes.

## Decisions

### D1: The detail decides from its own read of the alert

The detail reads its alert at the list's interval as well as on `refreshKey`, and judges its status. An alert is *ended* when its status is `closed` or `expired`, or when it is no longer found.

A read that fails for another reason, for example while Alerta is unreachable, changes nothing: the detail keeps what it shows, and the next read that succeeds decides.

*Alternatives:*
- Close the detail when the alert is missing from a fresh list: shelving an alert from its detail would close it, though *Unshelve* is offered there; so would a severity or search that no longer matches, and a list cut at its limit can leave out an alert that still matches. It also needs care for the answer that still belongs to the previous filter.
- Keep the detail on `refreshKey` only and look the alert up in the list's answer: the list is limited and carries fewer fields, so the detail would still show stale history.

### D2: Only an end seen by the detail closes it

The detail closes only when it has shown its alert not ended and a later read finds it ended. An alert that had already ended when the detail was opened, from a link, the *Closed* list or a return through the navigation, stays open. An end the area keeps the detail for (D3) is judged again at every later read, so the detail closes once the filter no longer lists the new status.

*Alternatives:* close every ended alert under a filter that does not list its new status, whenever it ended. A link to a closed alert from an incident would then close at once, and the operator could not read it.

### D3: Under a filter that lists the new status, the detail stays

The detail reports the status its alert ended with (none for a deleted alert), and the area keeps the detail when the status filter lists that status: the alert then stays in the list, so its detail stays too and shows the new status with its actions, such as *Reopen*. No status filter lists `expired`, so an alert that expires under *All* leaves the list and closes its detail.

*Alternative:* keep the detail under any filter with an ended status. An expiring alert would then leave the list under *All* and keep its detail.

### D4: Closing replaces the address

The detail closes by replacing the address with the list's, keeping the filter. Going back then leads to where the operator was before opening the alert, not to the ended alert.

Keyboard focus that was in the detail, such as on its *Close…* button, would be lost with it, so it moves to the alert list, without scrolling the page. The detail follows the focus as it moves in and out, since the read that finds the alert ended removes the buttons it no longer allows, focused or not, before the detail closes. Focus anywhere else, for example in the search while a refresh closes the detail or on the page after a click on plain text, stays where it is. The hidden detail is not revealed, so closing it doesn't scroll the page either.

*Alternative:* a new history entry. Back would reopen the ended alert's detail, which would stay open by D2, and show what has just gone away.

### D5: The cost

One more request per interval while a detail is open, for one alert by ID. With automatic refresh off, the detail is read only on *Refresh now* and after actions, as before.

## Risks / Trade-offs

- An alert that ends and is reopened between two reads is not noticed. The next read shows it open, which is its current state.
- With automatic refresh off, an alert that ends elsewhere keeps its detail until *Refresh now*, as the list keeps its row.
