# Core Strategy: Tackling the AI Procurement Scenarios

This document breaks down the thought process, the "Aha!" moments, and the technical implementation behind each of the four scenarios in the project. 

*Read this to understand the underlying logic—"ye padh ke toh mereko hit hua ki ye approach kar sakte hai!" (Reading this hits the spot on how we can approach this).*

---

## Scenario 1: The Happy Path (Basic Math & Validation)

**The Problem:**
A background system blindly generates a recommendation to "Buy 800 units." How do we get the AI to figure out if that number is actually correct?

**The "Aha!" Moment:**
At first, you might think: *"I'll just pass all the database numbers to the LLM and ask it to do the math."* 
**The breakthrough:** Never let the AI do raw math! LLMs hallucinate numbers all the time. If the LLM makes a math error, we overspend. The better approach is to let the AI be a "researcher." We give the AI a tool called `calculatePurchaseRequirement`. The AI calls this tool, and our deterministic TypeScript backend safely runs the formula (`Forecast + Safety Stock - Current Inventory - Incoming Orders`) and directly hands the exact answer to the AI.

**The Implementation:**
1. AI starts investigating.
2. AI calls `getInventory`, `getDemandForecast`, and `getOpenPurchaseOrders` tools to gather evidence.
3. AI calls `calculatePurchaseRequirement` to get the hard math. (Result: we actually only need 280 units).
4. AI proposes a structured JSON object to `CREATE_PO` for 280 units.
5. The backend (`validatePurchaseAction`) aggressively double-checks the cost against the budget before proving the action is safe for a human to approve.

---

## Scenario 2: Supplier Capacity Limit (Splitting Orders)

**The Problem:**
The system says we need 500 units. We check our primary supplier (SUP-001) but they only have the capacity to fulfill 250 units! 

**The "Aha!" Moment:**
If the AI just reduces the order to 250 units, the company runs out of stock because the business requirement was 500. The AI needs to adapt dynamically. The trick was designing our output JSON structure to natively accept an *Array of Actions* instead of a single string. If the JSON can handle arrays, the AI can conceptually "split" the order across multiple competitors.

**The Implementation:**
1. AI calculates the requirement (500 units).
2. AI checks Primary Supplier limits (capacity: 250).
3. The AI intelligently calls `getAlternativeSuppliers` and finds SUP-002.
4. AI generates an array of TWO actions:
   * `[{ supplierId: 'SUP-001', quantity: 250 }, { supplierId: 'SUP-002', quantity: 250 }]`
5. At the execution stage, our Node.js server loops over both actions and wraps them in a `prisma.$transaction([])`. This means if one database insert fails, both fail atomically, preventing partial ghost orders.

---

## Scenario 3: The Stale Forecast (Concurrency Issue)

**The Problem:**
The AI investigates and decides we need 280 units. It presents this nicely on the dashboard. But the human operator goes to lunch for 45 minutes before clicking "Approve". During lunch, a massive surge in sales changes the live database forecast to 1000 units. If the human clicks approve on the 280 unit plan, we will massively understock!

**The "Aha!" Moment:**
The challenge here is "State Concurrency." How do we know the data the AI looked at is still completely true when the human clicks execute? The breakthrough was implementing **Version Tracking**. Every time the database forecast updates, an integer counter increments (`version: 1 -> version: 2`).

**The Implementation:**
1. When the AI investigates, we quietly attach `forecastVersion: 1` to the draft decision.
2. In the background, the "Simulate Forecast Change" button increments the real database to `version: 2`.
3. The user clicks "Approve & Execute". 
4. Before doing anything, our backend strictly compares the draft version against the live database version. `(1 !== 2)`.
5. The backend aggressively blocks the HTTP request and throws a `Stale State` error.
6. The React frontend catches this blocker, and autonomously triggers a fresh "Re-Investigation" loop with the new numbers so the AI can correct itself visually for the user.

---

## Scenario 4: The Stale Budget (The Ultimate Fallback)

**The Problem:**
Similar to Scenario 3, but this time it's the budget that crashes. The purchase originally costs ₹336,000, and the initial budget was ₹800,000. But before approval, the budget drops to ₹250,000. 

**The "Aha!" Moment:**
When the backend blocks the stale transaction and forces the Re-Investigation, the AI realizes that `₹336,000 > ₹250,000`. The AI simply cannot afford the purchase. If it lowers the quantity to fit the budget, we fail our inventory requirements. The breakthrough was designing a safe eject button: the **ESCALATE** protocol.

**The Implementation:**
1. Execution is blocked due to the version mismatch.
2. The AI Re-Investigates with the fresh, low budget.
3. The math reveals a hard financial collision.
4. Instead of picking a random quantity, the AI selects the action `ESCALATE` with `quantity = 0`.
5. Our validation system (`validatePurchaseAction.ts`) has a strict `if` block: if the action is ESCALATE, we bypass all the complex MOQ and capacity checks seamlessly, because we aren't executing a purchase. 
6. The UI cleanly registers `ESCALATE`, `0 units`, and `₹0` so nothing breaks (No NaN errors), and human intervention is legally requested without spending a single dime.
