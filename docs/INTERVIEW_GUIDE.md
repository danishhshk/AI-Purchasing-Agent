# AI Purchasing Agent — Interview Guide

## 1. What does this project do?

**30-Second Explanation:**
"This project is a full-stack AI Purchasing Agent designed to automate supply chain procurement visually. It solves the problem of manual cross-checking in e-commerce by having an AI investigate purchasing recommendations. Given an input recommendation (like 'buy 800 earbuds'), the agent uses tools to read the live database—checking inventory, forecasts, supplier limits, and budget. It then makes a decision to either approve, modify, or escalate the purchase. The system securely validates this decision against strict mathematical constraints before a human clicks 'approve' to execute the purchase atomically."

* **Problem it solves:** Mental exhaustion and manual math errors in procurement.
* **Input:** A system-generated purchasing recommendation (e.g., 800 units of SKU-104).
* **Agent investigates:** Current inventory, demand forecast, open inbound orders, supplier constraints (MOQ, capacity), available budget, and storage capacity.
* **Decision:** `ACCEPT`, `MODIFY` (split orders, adjust quantities), or `ESCALATE` (if budget/storage entirely blocks the purchase).
* **Action:** `CREATE_PO` or `NO_ACTION` or `ESCALATE`.
* **Validation:** Before execution, deterministic TypeScript logic forces checks on budget `(cost <= budget)`, storage, and supplier conditions.

---

## 2. Project Architecture

The architecture separates intelligent reasoning (AI) from business constraint enforcement (Deterministic Code).

```text
Frontend (React/Vite)
       ↓  /api/agent, /api/execute
Backend API (Express - server.ts)
       ↓  runAgentInvestigation()
Agent (agent.ts / OpenAI API)
       ↓  Function Calling
Tools (tools.ts)
       ↓  Read/Calculate
Business Logic & Validators (calculations.ts, validation.ts)
       ↓  Prisma Client
Database (SQLite - dev.db)
```

1. **Frontend:** `frontend/src/App.tsx`. Renders the dashboard, demo scenarios, and human approval UI.
2. **Backend/API:** `backend/src/server.ts`. Hosts the Express server, intercepts requests, and handles execution blocking if states are stale.
3. **Agent:** `backend/src/agent/agent.ts`. Orchestrates the OpenAI LLM or Mock Provider. It feeds the LLM system prompts and tools.
4. **Tools:** `backend/src/tools/tools.ts`. Contains implementations for all tools the Agent can invoke (e.g., fetching inventory).
5. **Business Logic & Validators:** `backend/src/services/` & `backend/src/validators/`. Contains strict math operations (`calculateInventoryGap`) and boundary checks (`validatePurchaseAction`) to keep the LLM honest.
6. **Database:** `backend/prisma/schema.prisma`. SQLite database tracking inventory, budgets, and purchase orders.

---

## 3. Technology Stack

* **Frontend Framework (React + Vite + TailwindCSS):**
  * *What:* A modern frontend UI library and ultra-fast build tool.
  * *Why:* Creates a smooth, reactive single page application (SPA). SPA state handles the demo scenarios easily without full page reloads.
  * *Where:* Implemented in the `frontend/` directory. 
* **Backend (Node.js + Express):**
  * *What:* A javascript server runtime. 
  * *Why:* Perfect for asynchronous LLM streaming, database operations, and serving REST APIs transparently.
  * *Where:* `backend/src/server.ts`.
* **Database (SQLite):**
  * *What:* Lightweight relational database.
  * *Why:* Allows the project to be a self-contained local demo without requiring Docker or Postgres installations.
  * *Where:* `backend/prisma/dev.db`.
* **ORM (Prisma):**
  * *What:* Type-safe Object Relational Mapper for Node. 
  * *Why:* It protects execution blocks with atomic `prisma.$transaction([])` methods and ensures schema types map directly to TypeScript types.
  * *Where:* Everywhere in backend communicating with the DB (`services/prisma.ts`).
* **AI SDK (OpenAI Node SDK):**
  * *What:* Official wrapper for calling GPT-4o.
  * *Why:* Provides structured tool-calling (`tool_choice`, `tools`) natively.
  * *Where:* `backend/src/agent/agent.ts`.
* **Testing Framework (Vitest):**
  * *What:* A blazing fast unit test runner made by the Vite team.
  * *Why:* Evaluates the TypeScript business constraints natively without mocking the whole express server.
  * *Where:* `backend/tests/`.
* **Build Tools (TypeScript, NPM Workspaces, Concurrently):**
  * *What:* Workspace orchestrators.
  * *Why:* Allows running both Frontend and Backend concurrently from one root command (`npm run dev`) and provides static typing across the stack.

---

## 4. How an Investigation Works

**Trace of a direct request:**
1. User clicks "Start Investigation" in the UI.
2. Frontend `App.tsx` calls `handleInvestigate()`.
3. Frontend fires a POST request to `/api/agent`.
4. Backend `server.ts` receives it and calls `runAgentInvestigation(runId, sku, nodeId, recommendedQty)` from `agent.ts`.
5. The Agent starts a loop. It sends the `SYSTEM_PROMPT` and the recommendation to the AI.
6. The AI decides it needs context, returning a `tool_call` for `getInventory`.
7. `agent.ts` intercepts the tool call, matches it, and runs `executeTool(..., 'getInventory')` in `tools.ts`.
8. Tool queries Prisma and returns a JSON string, adding it to the message loop.
9. After gathering all evidence, the AI generates a final JSON Decision.
10. `server.ts` returns the `decision` response.
11. Frontend `App.tsx` stores it in React state and renders the green/yellow/red decision panels.

---

## 5. Explain Every Agent Tool

**getInventory**
* *Purpose:* Fetches current inventory constraints.
* *Output:* Current, Reserved, Safety Stock, Reorder Point.
* *Why it's needed:* The AI needs to know how much is already in the warehouse before buying more.

**getDemandForecast**
* *Purpose:* Shows upcoming demand.
* *Output:* Forecast predictions for 3, 5, 7, 14 days.
* *Why it's needed:* To calculate how much stock will actually be consumed during the supplier lead time.

**getOpenPurchaseOrders**
* *Purpose:* Fetches inbound shipments.
* *Output:* Array of `CONFIRMED` or `PENDING` purchase orders.
* *Why it's needed:* To prevent the AI from double-ordering stock that is already on the delivery truck.

**getAlternativeSuppliers**
* *Purpose:* Finds who sells the SKU.
* *Output:* Multiple suppliers with their MOQ, Unit Cost, and fulfillment capacity. 
* *Why it's needed:* Necessary for Scenario 2 (splitting orders if Primary Supplier is out of capacity).

**getSupplier**
* *Purpose:* Gets details of a specific supplier.
* *Output:* Supplier lead time, reliability score.

**getBudget**
* *Purpose:* Checks internal financial bounds.
* *Output:* Available and committed budget amounts.
* *Why it's needed:* Stops the AI from purchasing if the company is broke (Scenario 4).

**getStorageCapacity**
* *Purpose:* Checks warehouse bounds.
* *Output:* Occupied and available palette capacities.
* *Why it's needed:* Ensures physical space exists for inbound items.

**calculatePurchaseRequirement**
* *Purpose:* Offloads tricky math perfectly to deterministic code.
* *Output:* The literal `inventoryGap` number mapping mathematically exactly.
* *Why it's needed:* LLMs hallucinate math. We run the calculation in raw TS and feed the answer back.

**validatePurchaseAction**
* *Purpose:* Pre-flight validation constraint tester.
* *Output:* Array of checks (Budget passed? Storage passed?).
* *Why it's needed:* Allows the AI to "dry run" a purchase to realize it fails, allowing it to autonomously pivot to 'ESCALATE' safely.

---

## 6. Explain the Purchasing Calculation

**The Beginner Math Example (Scenario 1):**

Think of a water tank.
1. **Available Inventory:** Current units minus reserved units physically sitting in boxes. (220 - 40 = **180**).
2. **Forecast & Safety:** We expect to sell **610** units. But we also have a rule: keep **150** units hidden as an emergency cushion (safety stock).
   * **Total Required:** 610 + 150 = **760**.
3. **Confirmed Incoming:** We have **300** units arriving tomorrow from an old purchase order.
4. **The Gap:** We need 760. We have 180 + 300 coming = 480.
   * `760 - 480 = 280`.
5. **Final Purchase Quantity:** **280 units**.
6. **Purchase Cost:** `280 * 1200 (Unit Cost) = ₹336,000`.

*Implemented in: `backend/src/services/calculations.ts` (calculateInventoryGap).*

---

## 7. Why Does the AI Need Tools?

"If we simply ask an LLM 'How many earbuds should I buy?', it has absolutely no idea what is actually inside our warehouse right now. LLMs represent frozen snapshots of internet text—they cannot read live databases automatically.

We provide the LLM with Tools (functions), empowering it to pull targeted, necessary context safely out of our live Prisma SQLite database. Instead of dumping the entire billion-row database into the prompt—which is slow, impossible, and insecure—tools allow the AI to 'interrogate' our system iteratively. It checks inventory, calculates cost against the budget tool, and formulates a dynamic response based exclusively on current reality."

---

## 8. AI vs Deterministic Business Logic

**Why shouldn't the LLM directly create the PO?**
"LLMs are probabilistic logic engines; they do not possess absolute guarantees against hallucinations. If an LLM misreads a number or ignores a constraint, directly creating a database PO could result in overspending millions or breaching warehouse capacities.

In this architecture:
* **The AI handles synthesis:** It writes the 'Why', gathers the evidence, selects the supplier, and splits orders conceptually.
* **Deterministic Logic handles rules:** Normal TypeScript (`validatePurchaseAction.ts`) verifies the final numbers mathematically. It checks if `budget >= cost` and `qty >= moq`. If the LLM proposes an invalid PO, the system aggressively halts it and rejects the action natively. The LLM only *proposes*, traditional logic *executes*."

---

## 9. Scenario 1 Walkthrough

**The Happy Path:**
1. A background system blindly suggests ordering **800 units**.
2. Frontend `/api/agent` triggers the AI.
3. The AI reads tools and discovers: Inventory is 180, Incoming is 300, Forecast is 610, Safety Stock is 150.
4. It calls `calculatePurchaseRequirement`, exposing an actual gap of **280 units**.
5. It proposes a `CREATE_PO` for **280 units** at ₹336,000.
6. The User clicks **Approve & Execute**.
7. Backend `/api/execute` triggers. `validatePurchaseAction` confirms ₹336K is well under the ₹800K Budget limit.
8. Prisma executes an atomic transaction creating the PO and decrementing the budget.
9. Post-action validation checks the database to verify the PO genuinely exists.

---

## 10. Scenario 2 Walkthrough

**Supplier Splitting:**
1. Requirement identified as **500 units**.
2. AI calls `getAlternativeSuppliers` and uncovers `SUP-001` (Primary) strictly caps out at **250 units** capacity. 
3. Rather than failing, the AI adapts and identifies `SUP-002` (Alternative).
4. The AI outputs `MODIFY` with an array of actions:
   * Action 1: 250 units from SUP-001
   * Action 2: 250 units from SUP-002
5. User clicks Approve.
6. **Atomic execution** occurs: `prisma.$transaction([createPo1, createPo2, deductBudget])` runs. Atomic means if ANY of these fail (e.g., database network drop), they ALL rollback instantly so we don't accidentally buy half an order and lose track.

---

## 11. Scenario 3 Walkthrough

**Stale Forecast:**
1. During the AI's investigation, the forecast was **610** (Version 1). The AI recommends buying 280 units.
2. While the human was staring at the screen deciding whether to click 'Approve', a massive marketing spike shifts the forecast in the DB to **1000** (Version 2).
3. Human clicks Approve.
4. In `server.ts`, the execution endpoint checks `agentRun.forecastVersion !== currentForecastState.version`. The mismatch is flagged!
5. **Execution Blocked.** The old recommendation is useless and dangerous.
6. The frontend automatically initiates a Re-Investigation `/api/agent` using the `RE_INVESTIGATE_AFTER_FAILURE` context natively.
7. The AI realizes the requirement is now larger. The total cost spikes to ₹804,000, which is higher than the ₹800K budget.
8. The AI returns **ESCALATE**.

---

## 12. Scenario 4 Walkthrough

**Stale Budget:**
1. During the AI investigation, the budget is a healthy **₹800,000** (Version 1).
2. The User clicks the "Simulate Budget Change" button which manipulates the DB in the background down to **₹250,000** (Version 2).
3. User clicks Approve to execute a PO that costs ₹336,000.
4. In `server.ts`, the code evaluates `agentRun.stateVersion !== currentBudgetState.version`.
5. The execution is blocked safely to prevent going bankrupt.
6. The system triggers a re-investigation. The AI attempts to process 280 units, runs it against the fresh ₹250K budget, fails the validation step intrinsically, and immediately returns **ESCALATE**. No PO is created.

---

## 13. Human Approval

* **Where it happens:** In `App.tsx` on the Frontend via the "Approve & Execute" button.
* **Before approval:** The LLM proposal is halted as 'AWAITING_APPROVAL'. A Pre-Action validation checklist is shown on screen proving the logic works conceptually. No database changes have occurred yet.
* **After approval:** A POST to `/api/execute` triggers the real atomic Prisma adjustments.
* **Why it exists:** AI should automate the tedious evidence gathering and drafting, but in high-stakes financial operations, a human (Procurement Manager) must always maintain final fiduciary liability.

---

## 14. Post-Action Validation

The execution validates itself *after* operations commit in `server.ts` to ensure silent failures or database race-conditions did not skew the numbers. 
1. **Creation Check:** The code queries `prisma.purchaseOrder.findUnique` to physically prove the new IDs exist in the table.
2. **Details Match:** It strictly asserts the fetched `retrievedPo.quantity === poCheck.quantity`.
3. **Ledger Arithmetic Verification:** It queries the budget again. It mathematically checks if the `updatedBudget` corresponds exactly to the previously checked budget minus the total cost deducted.
4. If it fails, the frontend receives `validationStatus: 'FAILED'` and alerts the admin.

---

## 15. Failure Handling

1. **Validation Failure (Insufficient Budget / Storage / MOQ):**
   * *What:* Human tries to execute an impossible order, or AI drafts a bad order.
   * *Agent Action:* Blocked natively by TypeScript. The Agent receives the blocked flag and outputs an `ESCALATE` state.
2. **Stale State:**
   * *What:* Versions shifted underneath the process.
   * *Agent Action:* Blocks. Re-investigates autonomously via a fresh run loop to adapt.
3. **Supplier Capacity (Scenario 2):**
   * *What:* Supplier can't fit the requirement. 
   * *Agent Action:* AI actively splits the order to a backup supplier automatically.
4. **Database Execution Failure:**
   * *What:* `prisma.$transaction` blows up dynamically.
   * *Agent Action:* The server responds with 500 error. The entire change rolls back natively, leaving the database utterly untouched.

---

## 16. Database

**Prisma Schema Models (`backend/prisma/schema.prisma`):**

* **`Product`**: Base catalog (SKU, Unit Cost).
* **`Supplier` & `SupplierProduct`**: Tracks partners, MOQs, capacity limits, and relationship IDs matching SKUs to Suppliers.
* **`FulfillmentNode`**: Represent physical warehouse locations (e.g. Mumbai).
* **`Inventory`**: Crucial live numbers for (Current, Reserved, Safety Stock, Reorder Point) at a given Node.
* **`Forecast` & `DemandHistory`**: Track predicted daily sales (next 3, 5, 7 days) and versioning.
* **`PurchaseOrder`**: Core transactional record combining Supplier, SKU, Node, Qty, Cost, and Status (PENDING/CONFIRMED).
* **`Budget` & `Storage`**: High-level caps for physical and monetary bounds at a Node, heavily guarded by tracking version numbers for race conditions.

Relationships are largely one-to-one (Inventory to SKU_Node) and one-to-many (Supplier to PurchaseOrders).

---

## 17. Mock AI Provider

* **Yes, it exists.** 
* *Why:* Sometimes evaluators don't have OPENAI keys, or we need 100% deterministic testing for CI/CD pipelines without network unreliability.
* *How it works:* Located in `agent.ts`. If `AI_PROVIDER=mock`, the code enters an `if` block, queries Prisma exactly as the tools would, and uses standard `if/else` logic to generate the exact same JSON format an LLM would yield natively.
* *Does it use the tools?* Yes, it calls the exact same `executeTool` functions to populate the audit logs just like a real LLM run.
* *OpenAI Provider:* If a key exists, a standard `while(iterations < 12)` loop intercepts tool calls, passes them to Prisma, pushes `tool_call_id` responses into messages, and generates a formatted JSON object loop termination.

---

## 18. API Endpoints

1. **POST `/api/agent`**
   * *Purpose:* Triggers an investigation or re-investigation.
   * *Input:* `{ sku, nodeId, recommendedQuantity, context? }`
   * *Output:* `{ runId, decision }`
   * *File:* `server.ts`
2. **GET `/api/agent`**
   * *Purpose:* Refresh logs / tool activity dynamically.
   * *Input:* `?runId=UUID`
   * *Output:* AgentRun JSON including full log traces.
   * *File:* `server.ts`
3. **POST `/api/execute`**
   * *Purpose:* Commit the action atomically to Prisma.
   * *Input:* `{ runId, nodeId, supplierId, quantity, unitCost }`
   * *Output:* `{ success: boolean, validation: checks, postValidation }`
   * *File:* `server.ts`
4. **POST `/api/scenarios`**
   * *Purpose:* Demo manipulation endpoint (resets DB, shrinks budget artificially).
   * *Input:* `{ action: 'REDUCE_BUDGET' | 'RESET_SCENARIO_1' }`
   * *Output:* Success string.
   * *File:* `server.ts`

---

## 19. Testing

* **Framework:** Vitest (Super-fast, ESM compatible).
* **Unit Tests (`backend/tests/unit/calculation.test.ts` & `validation.test.ts`):** 
  * They verify the deterministic code mathematically isolated from the database.
* **Important covered scenarios:** 
  * "Calculates net requirement correctly" (Asserts gap math).
  * "Budget PASS/FAIL" logic testing.
  * "Primary capacity exceeded causes action split".
  * "Stale forecast version blocks execution".
* *Why it's important:* Since the AI is probabilistic, our defensive walls MUST be strictly unit tested to prove that no hallucination can ever break production records. The tests prove our constraints are impenetrable.

---

## 20. Security

* **Keys:** Stored purely in local server memory or standard `.env` hidden variables natively using `dotenv` in the Node environment. 
* **Gitignore:** Real `.env` files containing secrets are completely `.gitignore`d so they don't commit to GitHub. We commit `.env.example` solely with blank variables for developers.
* **Frontend Security:** The frontend React code is served purely as a static asset package bundle. If we compiled `OPENAI_API_KEY` into Vite, users could inspect their raw browser console Javascript to steal the API key. 
* **Backend Proxy:** Therefore, the Frontend exclusively asks the robust Express Backend (`/api/agent`), which secretly holds the API key and asks OpenAI.

---

## 21. Important Design Decisions

1. **Decision: Separation of AI and Business Rules.**
   * *Why:* LLMs are bad at math and absolute guardrails.
   * *Alternative:* Letting the LLM output SQL writes.
   * *Reason:* Complete catastrophic risk exposure.
2. **Decision: Audited Tool Logs.**
   * *Why:* Giving transparency into *what* the AI queried provides explainable AI required for Enterprise approval.
3. **Decision: Human-in-the-Middle.**
   * *Why:* Prevents automated cash runaways. Ensures financial liability controls.
4. **Decision: Atomic execution via `prisma.$transaction`.**
   * *Why:* If budget decreases but PO creation fails randomly, ledger becomes desynced. `transaction` fixes this.
5. **Decision: Stale-State version checks.**
   * *Why:* Concurrency handling. What if the state shifts massively while the human takes 30 minutes to press approve? Bails out safely.
6. **Decision: Mock Provider implementation.**
   * *Why:* Makes GitHub take-home evaluations flawless regardless of API downtimes or limits.
7. **Decision: React + Vite + Node.js decoupled.**
   * *Why:* Independent scaling for the React CDN bundle and Node Worker API endpoints locally.
8. **Decision: Post-Action Verifications.**
   * *Why:* Absolute defensive programming ensuring database integrity actually settled correctly on disk. 
9. **Decision: Use of TypeScript globally.**
   * *Why:* Shared JSON schema mappings protect both the express parser and the frontend renders seamlessly.
10. **Decision: Scenario Simulator UI.**
    * *Why:* Makes demonstrating complex failure states intuitively clear to evaluators without manual DB tweaking.

---

## 22. Weaknesses / Limitations

To be completely honest, a real system would need:
1. **True Queuing:** Right now, the AI waits linearly in an Express request thread. In production, this must use a Message Queue (e.g., RabbitMQ, background Webhooks) to prevent HTTP timeouts over long OpenAI generation tasks.
2. **No Authentication:** AuthJS/JWT user session controls are completely bypassed maliciously in this demo.
3. **Mock Data Sync:** A real environment requires external ERP synchronization services (SAP/Oracle connections) rather than a local SQLite mock seed.

---

## 23. Top 30 Interview Questions

1. **Q:** What is the core value proposition of an AI agent here?
   **A:** Eliminating mental math required to correlate disjointed logistics tables. 
2. **Q:** Why not let AI directly adjust DB rows?
   **A:** Probabilistic LLMs cannot be trusted with rigid mathematical constraints safely. (See `server.ts` blocking mechanism).
3. **Q:** Describe how state-change recovery works?
   **A:** Version tracking (`budget.version`) intercepted natively in `/api/execute`.
4. **Q:** What is an atomic transaction in Prisma?
   **A:** A bundle of database alterations where ALL pass, or ALL fail natively as a unified chunk.
... *(You can easily derive dozens more from the sections above)*

---

## 24. 60-Second Project Explanation

"I built an AI-powered Purchasing Agent that automates the tedious, multi-variable lookup required in Quick-Commerce supply chains. It acts as an Audited State Machine. When a recommendation drops—like 'Buy 800 units'—instead of a human hunting through five tables, my Node.js agent queries live database endpoints via OpenAI tools. It calculates accurate inventory gaps, handles supplier limits, and proposes the smartest action automatically. Crucially, I implemented a 'Sandboxed execution strategy'—the AI cannot write code. Its decisions are verified extensively against strict deterministic TypeScript boundary constraints before a human simply clicks 'Approve' to finalize the transaction defensively."

---

## 25. 5-Minute Project Explanation

*(Combine Section 1, 2, 4, 8, and 12 naturally into conversational segments...)*

**1. The Problem Space:** "Supply chains bleed margins because manually checking storage capacities against MOQs while adjusting for volatile forecasts exhausts human operators. I wanted to build an AI that doesn't just chat, but mathematically calculates actions."
**2. The Guardrails:** "The biggest technical hurdle I wanted to solve was hallucination. If the AI buys ₹1,000,000 of stock when we only have ₹250,000, we're in trouble. So I architected a system where the AI is only a 'Researcher/Drafter'. I use OpenAI function calling rigorously locked down by deterministic Prisma calls. The AI creates a draft `decision` JSON."
**3. Real Scenario:** "For example, in Scenario 2, my code realizes Supplier A only has 250 units but we need 500. So the AI automatically splits the drafted PO between two competitors. It's incredibly smart."
**4. Execution:** "When the human clicks approve in the React frontend, it triggers my `/api/execute` endpoint. Here, I implemented 'Stale State Tracking'. If the budget randomly crashed between the AI's research phase and the human's click, my backend blocks the transaction dead, forces the AI to reinvestigate on fresh data, and alerts the user to `ESCALATE`. Finally, successful processes execute via an atomic `prisma.$transaction` rollback wrapper to ensure total ledger security!"
