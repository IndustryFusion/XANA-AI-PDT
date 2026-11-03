# Spec Delta

## Purpose

Lets maintainers manage the documents (manuals, maintenance procedures, specification sheets) that the agent retrieves from when reasoning, and check what retrieval returns for a question.

## ADDED Requirements

### Requirement: Documents per pipeline
The knowledge base SHALL list documents of the selected ingestion pipeline with name, status, date, number of chunks and description, and explain what each pipeline is suited for.

#### Scenario: Choose pipeline
- **WHEN** the operator switches between the base pipeline (page text, faster) and the structured pipeline (section-aware, better for tables and diagrams)
- **THEN** the documents of that pipeline are listed

#### Scenario: No documents
- **WHEN** a pipeline has no documents
- **THEN** the list says that no documents have been ingested yet

### Requirement: Upload documents
The operator SHALL be able to add PDF, Word and Markdown documents by dropping them or choosing files, and follow each upload's progress until it is done or failed.

#### Scenario: Upload succeeds
- **WHEN** the operator drops a supported document
- **THEN** it appears with progress, and when ingestion completes it shows as done with its number of chunks

#### Scenario: Unsupported file
- **WHEN** the operator drops a file of an unsupported type or above the size limit
- **THEN** it is refused with the reason and nothing is uploaded

#### Scenario: Ingestion fails
- **WHEN** ingestion of a document fails
- **THEN** the document shows as failed with the reason and can be removed

### Requirement: Describe and delete documents
The operator SHALL be able to edit a document's description and delete a document after confirmation.

#### Scenario: Edit description
- **WHEN** the operator edits and saves a description
- **THEN** the new description is shown

#### Scenario: Delete a document
- **WHEN** the operator deletes a document and confirms
- **THEN** it is removed from the list

### Requirement: Test retrieval
The operator SHALL be able to enter a question and see the ranked passages that retrieval returns, each with its source document, location and score.

#### Scenario: Results
- **WHEN** the operator runs a test query
- **THEN** ranked passages are shown with source document, page or section, and score

#### Scenario: No results
- **WHEN** retrieval finds nothing
- **THEN** the result says that no passages were found
