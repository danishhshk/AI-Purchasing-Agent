# AI Purchasing Agent

## Overview
An intelligent, deterministic full-stack AI Purchasing System built with **React (Vite), Node.js (Express), and Prisma**. It automates procurement decisions by blending LLM reasoning with strict deterministic backend validation.

Instead of a generic chatbot, this system implements an **Audited State Machine**. The LLM is responsible for investigation, synthesis, and decision-making over live database state, while deterministic TypeScript services rigorously enforce hard business constraints and validate every single action. 

## Live Demo
You can run the full application stack locally using NPM Workspaces and concurrently test the agent's behavior. 

## Architecture
See [docs/architecture.md](docs/architecture.md) for the visual Mermaid diagram.

**Agent Architecture:**
- **AI Provider:** Supports OpenAI GPT-4o or Mock provider for deterministic environments.
- **Tools:** `getInventory`, `getDemandForecast`, `getBudget`, `calculatePurchaseRequirement` tools safely read and map the live Node.js backend services.
- **Deterministic Validators:** The agent’s math is completely sandbox-tested. Any constraint (budget overspend, storage exhaustion, MOQ mismatch) immediately rejects the decision. 

## Agent Workflow
1. **System Recommendation:** A basic background job identifies a potential inventory gap based on basic analytics.
2. **Investigation:** The AI agent analyzes actual requirements via tools, retrieving safety stock, forecast, and vendor limits.
3. **Structured Proposal:** The AI outputs an Action (`MODIFY` / `ESCALATE` / `CREATE_PO`) strictly evaluating alternatives.
4. **Human Approval:** Proposed changes await approval in the frontend sandbox.
5. **Atomic Execution:** Operations are committed transactionally. A failure reverses all dependent operations securely.
6. **Post-Action Validation:** Post transaction checks prove expected balances were properly deducted.

## Demo Scenarios

### Scenario 1: Standard Replenishment
- Initial suggestion: 800 units.
- AI calculates requirement: **280 units**.
- Result: **CREATE_PO** for 280 units.
- Cost: ₹336,000. 
- Validation: **Success**

### Scenario 2: Supplier Capacity Limit
- Initial requirement: **500 units**.
- Supplier 1 Capacity limits to 250 units.
- AI identifies constraint and splits the PO: **250 from SUP-001** and **250 from SUP-002**.
- Cost: ₹612,500.
- Execute: **Atomic execution** succeeds. Validation: **Success**

### Scenario 3: Forecast Change (Stale State)
- Initial Forecast: **610** (version 1)
- User modifies forecast mid-decision to **1000** (version 2)
- State Mismatch Detected: **Stale decision detected**
- Flow: **Execution blocked** -> **Re-investigation** triggered natively.
- New Requirement: **670 units**
- Cost Requirement: **₹804,000**
- Validation: **Insufficient budget** remaining
- Final AI Action: **ESCALATE**

### Scenario 4: Budget Constraint (Stale State)
- Initial Budget: **₹800,000** (version 1)
- User modifies budget mid-decision: **Budget changes to ₹250,000** (version 2)
- State Mismatch Detected: **Stale decision detected**
- Flow: **Execution blocked** -> **Re-investigation** triggered natively.
- New Requirement: **280 units**
- Cost Requirement: **₹336,000**
- Validation: **Insufficient budget** (needs ₹336K but only has ₹250K).
- Final AI Action: **ESCALATE**

## Stale State Handling & Re-investigation
As explicitly outlined in Scenarios 3 and 4, the environment tracks state versions on vital bounds (Budgets, Forecasts). If the system attempts to blindly commit an LLM record that was reasoned based on outdated parameters, the backend intercepts this gap, marks the execution as stale, and forces the Agent into a **Re-Investigation**. This maintains pure system integrity even under concurrency.

## Setup Instructions

### Prerequisites
- Node.js installed

### 1. Installation & Environment
```bash
# Install dependencies for both frontend and backend automatically via npm workspaces
npm install

# Setup local database and seed data
cd backend
npx prisma db push
npx tsx prisma/seed.ts
cd ..
```

### 2. Environment Variables
Copy `.env.example` to `.env` in the root:
```env
AI_PROVIDER=mock
OPENAI_API_KEY=""
DATABASE_URL="file:./dev.db"
```
*Note:* `AI_PROVIDER=mock` uses the built-in Mock provider which executes deterministic AI routines without requiring an OpenAI key, which is perfect for demonstration and CI pipelines. Change to an OpenAI model and provide your `OPENAI_API_KEY` to run live queries.

### 3. Running Locally
```bash
# Run both frontend and backend concurrently from the root directory
npm run dev
```
Visit `http://localhost:5173/` in your browser. The backend will run simultaneously on `http://localhost:3000/`.

### 4. Tests and Building
```bash
# Run backend validation and calculation tests
npm test

# Run frontend linting
npm run lint

# Check frontend types and build it for production
npm run build
```

## Known Limitations
- No true user Auth flow (AuthJS can be implemented easily).
- Database is local SQLite. It can be horizontally scaled to Postgres smoothly via Prisma.
