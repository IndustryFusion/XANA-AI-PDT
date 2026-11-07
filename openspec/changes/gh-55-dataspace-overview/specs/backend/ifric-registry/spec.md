# Spec Delta

## ADDED Requirements

### Requirement: More names from the registry
When a company's details don't name it, the backend SHALL look in the registry's company directory, and then, for a factory ID, take the name of the factory's owner. It SHALL name machines by their asset names at `/api/ifric/resolve-machines`.

#### Scenario: Company in the directory
- **WHEN** a peer's company details are refused or empty, and the directory lists the company, on a real IFRIC registry
- **THEN** its name is the directory's

#### Scenario: Factory owner
- **WHEN** an ID is a factory that the registry knows, with an owner
- **THEN** its name is the owner's

#### Scenario: Asset names
- **WHEN** machine IDs are resolved at `/api/ifric/resolve-machines`, on a real IFRIC registry
- **THEN** each machine the registry knows is given its asset name, and the others are left out

#### Scenario: Directory read once
- **WHEN** several names are resolved within 300 seconds with the same token
- **THEN** the directory is read once

#### Scenario: Registry unavailable
- **WHEN** the registry can't be reached, refuses, or isn't configured
- **THEN** the names are left out, and the requests still answer
