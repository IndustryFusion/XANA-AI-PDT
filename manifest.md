# XANA AI PDT — System Design (From Scratch)

## 🎯 Purpose

XANA AI PDT (Process Digital Twin AI) is a **stateful industrial AI system** that:

- Observes machine and process state via NGSI-LD
- Detects and analyzes anomalies
- Executes structured diagnostic reasoning
- Suggests or triggers corrective actions
- Learns from past incidents

It is NOT a chatbot.

It is:
> ✅ A **decision-support and troubleshooting system for industrial processes**

---

# 🏗️ System Architecture (From Scratch)

```
Frontend (React)
        │
        ▼
Backend (Python / FastAPI)
 ├─ API Layer (REST + WebSocket)
 ├─ Agent Runtime (LangGraph)
 ├─ Tool Layer
 │    ├─ NGSI-LD Client
 │    ├─ Timescale Client
 │    └─ Postgres Memory
 ├─ Event Layer (Subscriptions / Triggers)
 └─ LLM Integration

Data Layer
 ├─ NGSI-LD (Scorpio) → live context
 ├─ TimescaleDB → time-series data
 └─ PostgreSQL → memory (incidents + traces)
```

---

# ✅ Assumed Existing Systems

The following components are ALREADY AVAILABLE and must be used:

## 1. NGSI-LD Broker (Scorpio)
- Stores entities, relationships, context
- Used for all structured system queries

## 2. TimescaleDB
- Stores machine signals and telemetry
- Used for validation and diagnostics

## 3. PostgreSQL
- Available as general-purpose database
- Used for AI memory (not for system state)

---

# 🔧 Components To Implement

## 1. Python Backend (FastAPI)

Responsibilities:
- Provide REST API
- Provide WebSocket updates
- Trigger agent execution
- Integrate services

---

## 2. Agent Runtime (LangGraph)

Core structure:

```
OBSERVE → HYPOTHESIZE → VALIDATE → DECIDE → ACT
```

### Responsibilities:
- Execute multi-step reasoning
- Call tools
- Maintain state during execution

---

## 3. Tool Layer

All system interaction goes through tools.

### Required Tools

#### NGSI Tool
- get entity
- query entities
- traverse relationships

#### Timescale Tool
- fetch recent signals
- query metrics over time

#### Memory Tool (Postgres)
- find similar incidents
- store new incident

---

## 4. Memory (PostgreSQL)

### Tables

#### incidents
- id
- machine_id
- issue
- root_cause
- resolution
- timestamp

#### agent_traces
- incident_id
- step
- action
- input
- output

---

## 5. Event Layer

Triggers agent execution from:

- NGSI-LD subscriptions
- alerts
- user actions

Flow:

```
event → agent runtime → result
```

---

## 6. Frontend (React)

### Required Features

#### Context View
- machine state
- relationships

#### AI Panel
- suggested actions
- reasoning summary

#### Incident Timeline
- steps taken
- decisions

### Key Principle

```
AI output → structured UI actions
```

NOT plain text chat.

---

# ⚙️ Environment Configuration

Create `.env` file:

```
NGSI_URL=http://localhost:9090
TIMESCALE_DB_URL=postgresql://user:pass@localhost:5432/timescale
POSTGRES_MEMORY_URL=postgresql://user:pass@localhost:5432/memory
LLM_API_KEY=your_api_key
LLM_MODEL=gpt-4o
```

---

# 🚀 Minimal Runnable Example

## requirements.txt

```
fastapi
uvicorn
requests
```

---

## main.py

```
from fastapi import FastAPI
import requests
import os

app = FastAPI()

NGSI_URL = os.getenv("NGSI_URL")

@app.get("/run")
def run_agent():
    response = requests.get(f"{NGSI_URL}/ngsi-ld/v1/entities")
    entities = response.json()

    if not entities:
        return {"status": "no data"}

    # Basic reasoning placeholder
    return {
        "status": "ok",
        "action": "inspect machine",
        "reason": "entities detected in NGSI-LD"
    }
```

---

## Run

```
pip install -r requirements.txt
uvicorn main:app --reload
```

---

## Test

Open in browser:

```
http://localhost:8000/run
```

---

# 🏁 Summary

XANA AI PDT is:

- A **stateful diagnostic AI system**
- Built on **NGSI-LD context**
- Using **tool-based reasoning**

Core elements:

- Agent (LangGraph)
- Tools (NGSI + TSDB + Memory)
- Backend (FastAPI)
- UI (React, action-driven)

---

# ✅ Next Implementation Steps

1. Build NGSI + Timescale tools
2. Implement LangGraph agent loop
3. Add Postgres memory
4. Add event triggers
5. Connect frontend
