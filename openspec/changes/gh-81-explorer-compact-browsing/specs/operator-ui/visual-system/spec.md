# Spec Delta

## ADDED Requirements

### Requirement: Compact scale
The UI SHALL use a base text size of 14 pixels, 13 pixels for dense rows such as attribute lines, 12 pixels for meta information, and a standard control height of 32 pixels, in every area and both themes. Text SHALL still scale with the browser's font-size setting.

#### Scenario: Base size
- **WHEN** any area is shown with the browser's default font size
- **THEN** body text is 14 pixels and standard inputs, selects and buttons are 32 pixels high

#### Scenario: Browser text size
- **WHEN** the operator raises the browser's default font size
- **THEN** text and controls grow with it and no content is cut off

#### Scenario: Contrast kept
- **WHEN** the accessibility checks run on each area in both themes at the compact scale
- **THEN** no contrast or target-size violations are reported
