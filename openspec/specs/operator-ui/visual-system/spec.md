# operator-ui/visual-system Specification

## Purpose
Keeps the operator UI consistent, readable and accessible across all areas: themes, status presentation, keyboard operation, layout and the standard loading, empty and error states.

## Requirements

### Requirement: Dark and light themes
The UI SHALL offer a dark and a light theme, follow the system preference by default, and let the operator override it.

#### Scenario: System preference
- **WHEN** the operator has not chosen a theme
- **THEN** the UI uses the theme matching the system colour-scheme preference

#### Scenario: Operator choice persists
- **WHEN** the operator chooses a theme
- **THEN** the UI switches immediately and keeps the choice after a reload

### Requirement: Readable status
Every status the UI shows (run states, severities, connection and health states) SHALL be identified by a text label, not by colour alone.

#### Scenario: Status without colour
- **WHEN** a status badge is rendered
- **THEN** it contains a text label that names the status, and the label is exposed to assistive technology

### Requirement: Contrast
Text and essential graphics SHALL meet a contrast ratio of at least 4.5:1 for normal text and 3:1 for large text and graphics in both themes.

#### Scenario: Automated contrast check
- **WHEN** the accessibility checks run on each area in both themes
- **THEN** no contrast violations are reported

### Requirement: Keyboard operation
All interactive elements SHALL be reachable and operable by keyboard, in a logical order, with a visible focus indicator.

#### Scenario: Keyboard-only navigation
- **WHEN** the operator uses only the keyboard
- **THEN** they can sign in, move between all areas and operate every control, and the focused element is always visible

#### Scenario: Dialogs
- **WHEN** a dialog opens
- **THEN** focus moves into it, stays within it until it closes, Escape closes it unless an action is in progress, and focus returns to the control that opened it

### Requirement: Standard data states
Every view that shows data SHALL have a loading state, an empty state that says what is missing, and an error state that says what failed and offers a retry.

#### Scenario: Retry after error
- **WHEN** a view is in its error state and the operator chooses retry
- **THEN** the view loads again and shows the data if the area has recovered

### Requirement: Layout widths
The UI SHALL be designed for desktop screens and remain usable at narrower widths, switching multi-column layouts to a single column below 900 pixels.

#### Scenario: Narrow window
- **WHEN** the window is narrower than 900 pixels
- **THEN** multi-column areas show one column and no content is cut off horizontally

### Requirement: Structured presentation
The UI SHALL present agent output as structured elements (steps, hypotheses with confidence, decisions, actions) rather than as a chat transcript; free text SHALL appear only in conversations with the machine builder.

#### Scenario: Agent output outside conversations
- **WHEN** agent output is displayed outside the machine-builder conversation
- **THEN** it appears in typed elements with labelled fields, not as unstructured text messages
