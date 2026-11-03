# Spec Delta

## Purpose

Gives operators one consistent frame around every screen of the operator UI: signing in, moving between areas, seeing who and which factory they act for, and noticing dataspace connection problems.

## ADDED Requirements

### Requirement: Sign-in when authentication is enabled
When the data source reports that authentication is enabled and there is no valid session, the UI SHALL show a sign-in screen instead of the application, naming the identity provider it signs in to.

#### Scenario: No session
- **WHEN** authentication is enabled and no session exists
- **THEN** the sign-in screen is shown with username and password fields and no application navigation

#### Scenario: Successful sign-in
- **WHEN** the operator submits valid credentials
- **THEN** the application opens on the screen that was requested

#### Scenario: Failed sign-in
- **WHEN** the operator submits invalid credentials or the identity provider cannot be reached
- **THEN** the sign-in screen stays open and shows a message that distinguishes wrong credentials from an unreachable provider

#### Scenario: Authentication disabled
- **WHEN** the data source reports that authentication is disabled
- **THEN** the application opens without a sign-in screen

### Requirement: Session expiry
The UI SHALL re-check the session periodically and return to the sign-in screen when the session is no longer valid.

#### Scenario: Session expires while working
- **WHEN** a periodic session check reports that the session is no longer valid
- **THEN** the sign-in screen is shown, and after signing in again the operator returns to the same screen

### Requirement: Sign-out
The UI SHALL let the operator sign out from the user menu.

#### Scenario: Sign out
- **WHEN** the operator chooses sign-out
- **THEN** the session is ended and the sign-in screen is shown

### Requirement: Main navigation
The header SHALL show the product name and a navigation entry for each area: Dashboard, Active incidents, Data explorer, Alerts, Incident history, Dataspace and System, with the current area marked.

#### Scenario: Navigate between areas
- **WHEN** the operator selects a navigation entry
- **THEN** that area is shown and its entry is marked as current, both visually and for assistive technology

### Requirement: Addressable screens
Every area and every selected item (run, incident, entity, alert) SHALL have its own URL, so the view can be bookmarked, shared and reloaded.

#### Scenario: Open by URL
- **WHEN** the operator opens the URL of an area or item directly
- **THEN** that area or item is shown after sign-in if required

#### Scenario: Reload keeps the view
- **WHEN** the operator reloads the page
- **THEN** the same area and selected item are shown again

#### Scenario: Unknown URL
- **WHEN** the operator opens a URL that matches no area
- **THEN** a not-found view is shown with a link to the dashboard

#### Scenario: Browser history
- **WHEN** the operator uses the browser back and forward buttons
- **THEN** the UI moves between the previously visited areas and items

### Requirement: User and factory information
The header SHALL show the signed-in operator and offer a user menu with name, e-mail, and the factory the operator acts for (factory identifier, owner and location when known).

#### Scenario: Show factory details
- **WHEN** the operator opens the user menu
- **THEN** name, e-mail and the available factory details are shown, and missing details are omitted without placeholders that look like data

### Requirement: Dataspace indicator
The header SHALL show the dataspace connection state, and when the dataspace session has expired it SHALL show a reconnect hint that leads to the Dataspace area.

#### Scenario: Connected
- **WHEN** the dataspace connection is valid
- **THEN** the indicator shows a connected state with a text label

#### Scenario: Session expired
- **WHEN** the dataspace session has expired
- **THEN** a reconnect hint is shown, and selecting it opens the Dataspace area

#### Scenario: Not configured
- **WHEN** no dataspace connection is configured
- **THEN** the indicator shows a not-configured state and no reconnect hint

### Requirement: Cross-navigation from entity references
Wherever the UI shows a reference to an entity, it SHALL offer to open the entity in the Data explorer, start a new incident for it, show its active incidents and show its incident history.

#### Scenario: Start an incident from a reference
- **WHEN** the operator chooses to start a new incident from an entity reference
- **THEN** the Active incidents area opens with the new-incident form prefilled with that entity's identifier

#### Scenario: Open an entity from a reference
- **WHEN** the operator chooses to open an entity reference in the Data explorer
- **THEN** the Data explorer URL for that entity is opened
