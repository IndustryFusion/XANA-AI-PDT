# Spec Delta

## ADDED Requirements

### Requirement: Access levels in the dataspace tile
The dataspace tile SHALL count compatible peers per access level and name those with elevated access.

#### Scenario: Levels shown
- **WHEN** the dashboard is opened while connected
- **THEN** the tile shows the number of standard, elevated and restricted peers, as the backend reports them, and names each elevated peer with the capabilities approved for it

#### Scenario: Unknown levels
- **WHEN** some peers' access can't be read
- **THEN** the tile counts them as unknown

#### Scenario: Not connected
- **WHEN** the dataspace is not connected or not configured
- **THEN** the tile shows the connection state without levels, and the other tiles are unaffected
