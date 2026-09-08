import express, { Request, Response } from 'express';
import cors from 'cors';
import { prisma } from './services/prisma';
import { runAgentInvestigation } from './agent/agent';
import { validatePurchaseAction } from './validators/validation';

const app = express();

app.use(cors());
app.use(express.json());

// Agent Routes
app.post('/api/agent', async (req: Request, res: Response) => {
    try {
        const { sku, nodeId, recommendedQuantity } = req.body;

        // Create new Run
        const agentRun = await prisma.agentRun.create({
            data: {
                status: 'RECEIVED'
            }
        });

        // Execute Agent
        const decision = await runAgentInvestigation(agentRun.runId, sku, nodeId, recommendedQuantity);

        res.json({
            runId: agentRun.runId,
            decision
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/agent', async (req: Request, res: Response) => {
    const runId = req.query.runId as string;

    if (!runId) {
        res.status(400).json({ error: 'Run ID missing' });
        return;
    }

    const run = await prisma.agentRun.findUnique({
        where: { runId },
        include: { logs: true }
    });

    res.json(run);
});

// Execute Routes
app.post('/api/execute', async (req: Request, res: Response) => {
    try {
        const { runId, nodeId, supplierId, quantity, unitCost } = req.body;

        const currentBudgetState = await prisma.budget.findUnique({ where: { nodeId } });
        const currentForecastState = await prisma.forecast.findUnique({ where: { sku_nodeId: { sku: 'SKU-104', nodeId } } });
        const agentRun = await prisma.agentRun.findUnique({ where: { runId } });

        // Idempotency check 
        if (agentRun?.status === 'COMPLETED') {
            return res.json({ success: true, message: "Already executed", validation: { valid: true, checks: [] } });
        }

        // Stale execution check
        if (agentRun && agentRun.stateVersion != null && currentBudgetState) {
            const isBudgetStale = agentRun.stateVersion !== currentBudgetState.version;
            const isForecastStale = (agentRun.forecastVersion != null && currentForecastState) ? agentRun.forecastVersion !== currentForecastState.version : false;

            if (isBudgetStale || isForecastStale) {
                // Reject stale execution
                await prisma.agentRun.update({
                    where: { runId },
                    data: {
                        status: 'VALIDATION_FAILED',
                        validationStatus: 'FAILED',
                        executedAction: 'BLOCKED_EXECUTION'
                    }
                });
                return res.json({
                    success: false,
                    stale: true,
                    message: "Execution blocked: State changed after investigation (Stale decision).",
                    validation: {
                        valid: false,
                        checks: [{
                            name: 'state_version',
                            passed: false,
                            message: `Purchase cannot be executed because the bounds changed after the original decision (${isBudgetStale ? 'Budget' : 'Forecast'} mismatch).`
                        }]
                    }
                });
            }
        }

        // Check if there are multiple actions via proposedActions array (Scenario 2)
        const proposedActionsRaw = agentRun?.proposedActions ? JSON.parse(agentRun.proposedActions) : [];
        const actionsToExecute = proposedActionsRaw.length > 0 ? proposedActionsRaw : [{ action: agentRun?.proposedAction || 'CREATE_PO', supplierId, quantity, unitCost }];

        // 1. Post/Final Verification before acting for ALL actions
        const valRes = await validatePurchaseAction(nodeId, actionsToExecute);

        // Save validation log
        await prisma.validationResult.create({
            data: {
                runId,
                stage: 'PRE_EXECUTION',
                valid: valRes.valid,
                checkDetails: JSON.stringify(valRes)
            }
        });

        if (!valRes.valid) {
            await prisma.agentRun.update({
                where: { runId },
                data: {
                    status: 'VALIDATION_FAILED',
                    validationStatus: 'FAILED',
                    executedAction: 'BLOCKED_EXECUTION'
                }
            });
            return res.json({ success: false, validation: valRes, message: "Blocked due to constraint failure" });
        }

        // 2. Adjust state (Storage / Budget) and CREATE PO transactionally
        let totalCostDeducted = 0;
        const transactionOperations = [];
        const createPoRecords: any[] = [];

        for (const act of actionsToExecute) {
            if (act.action === 'CREATE_PO') {
                const actTotalCost = act.quantity * act.unitCost;
                totalCostDeducted += actTotalCost;
                const poId = `PO-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

                transactionOperations.push(prisma.purchaseOrder.create({
                    data: {
                        poId,
                        sku: 'SKU-104',
                        nodeId,
                        supplierId: act.supplierId,
                        quantity: act.quantity,
                        unitCost: act.unitCost,
                        totalCost: actTotalCost,
                        expectedArrivalDays: 5,
                        status: 'CONFIRMED'
                    }
                }));

                createPoRecords.push({ poId, supplierId: act.supplierId, quantity: act.quantity, unitCost: act.unitCost, totalCost: actTotalCost });
            }
        }

        const budget = await prisma.budget.findUnique({ where: { nodeId } });
        if (budget && totalCostDeducted > 0) {
            transactionOperations.push(prisma.budget.update({
                where: { nodeId },
                data: {
                    committedAmount: budget.committedAmount + totalCostDeducted,
                    availableBudget: budget.availableBudget - totalCostDeducted
                }
            }));
        }

        // Execute Transaction atomically
        await prisma.$transaction(transactionOperations);

        // Post action validation
        const postValChecks: any[] = [];
        let postValid = true;

        for (const poCheck of createPoRecords) {
            const retrievedPo = await prisma.purchaseOrder.findUnique({ where: { poId: poCheck.poId } });
            if (retrievedPo && retrievedPo.quantity === poCheck.quantity && retrievedPo.supplierId === poCheck.supplierId && retrievedPo.status === 'CONFIRMED') {
                postValChecks.push({ name: 'po_created', passed: true, message: `PO ${poCheck.poId} successfully created for ${poCheck.quantity} units from ${poCheck.supplierId}.` });
            } else {
                postValChecks.push({ name: 'po_created', passed: false, message: `PO creation verification failed for ${poCheck.poId}.` });
                postValid = false;
            }
        }

        const updatedBudget = await prisma.budget.findUnique({ where: { nodeId } });
        if (budget && totalCostDeducted > 0) {
            if (updatedBudget && Math.abs(updatedBudget.availableBudget - (budget.availableBudget - totalCostDeducted)) < 0.01) {
                postValChecks.push({ name: 'budget_updated', passed: true, message: `Budget updated correctly (deducted ₹${totalCostDeducted.toLocaleString()}).` });
            } else {
                postValChecks.push({ name: 'budget_updated', passed: false, message: 'Budget update verification failed.' });
                postValid = false;
            }
        }

        await prisma.agentRun.update({
            where: { runId },
            data: {
                status: 'COMPLETED',
                executedAction: 'CREATE_PO',
                validationStatus: postValid ? 'SUCCESS' : 'FAILED'
            }
        });

        res.json({ success: postValid, validation: valRes, postValidation: { valid: postValid, checks: postValChecks } });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Scenarios Route
app.post('/api/scenarios', async (req: Request, res: Response) => {
    const { action } = req.body;

    if (action === 'REDUCE_BUDGET') {
        await prisma.budget.update({
            where: { nodeId: 'NODE-BOM' },
            data: {
                availableBudget: 250000.0,
                version: { increment: 1 }
            }
        });
        res.json({ success: true, message: 'Budget radically reduced.' });
        return;
    }

    if (action === 'CHANGE_FORECAST') {
        await prisma.forecast.update({
            where: { sku_nodeId: { sku: 'SKU-104', nodeId: 'NODE-BOM' } },
            data: { next7Days: 1000, version: { increment: 1 } }
        });
        res.json({ success: true, message: 'Forecast surged to 1000.' });
        return;
    }

    if (action.startsWith('RESET_SCENARIO_') || action === 'RESET_DEMO') {
        // Base uniform clean slate
        await prisma.purchaseOrder.deleteMany({
            where: { NOT: { poId: 'PO-1234' } }
        });
        await prisma.purchaseOrder.upsert({
            where: { poId: 'PO-1234' },
            create: { poId: 'PO-1234', sku: 'SKU-104', nodeId: 'NODE-BOM', supplierId: 'SUP-001', quantity: 300, unitCost: 1200, totalCost: 360000, expectedArrivalDays: 5, status: 'CONFIRMED' },
            update: { quantity: 300, status: 'CONFIRMED' }
        });
        await prisma.inventory.update({
            where: { sku_nodeId: { sku: 'SKU-104', nodeId: 'NODE-BOM' } },
            data: { currentQuantity: 220, reservedQuantity: 40, safetyStock: 150 }
        });
        await prisma.storage.update({
            where: { nodeId: 'NODE-BOM' },
            data: { totalCapacityUnits: 1000, occupiedCapacityUnits: 500, availableCapacityUnits: 500 }
        });
        await prisma.budget.update({
            where: { nodeId: 'NODE-BOM' },
            data: { availableBudget: 800000.0, committedAmount: 400000.0, version: 1 }
        });

        if (action === 'RESET_SCENARIO_2') {
            await prisma.forecast.update({
                where: { sku_nodeId: { sku: 'SKU-104', nodeId: 'NODE-BOM' } },
                data: { next7Days: 830, version: 1 }
            });
            await prisma.supplierProduct.update({
                where: { supplierId_sku: { supplierId: 'SUP-001', sku: 'SKU-104' } },
                data: { fulfillmentCapacity: 250 }
            });
            await prisma.supplierProduct.update({
                where: { supplierId_sku: { supplierId: 'SUP-002', sku: 'SKU-104' } },
                data: { fulfillmentCapacity: 9999 }
            });
        } else {
            // S1, S3, S4 default
            await prisma.forecast.update({
                where: { sku_nodeId: { sku: 'SKU-104', nodeId: 'NODE-BOM' } },
                data: { next7Days: 610, version: 1 }
            });
            await prisma.supplierProduct.update({
                where: { supplierId_sku: { supplierId: 'SUP-001', sku: 'SKU-104' } },
                data: { fulfillmentCapacity: 9999 } // unconstrained
            });
            await prisma.supplierProduct.update({
                where: { supplierId_sku: { supplierId: 'SUP-002', sku: 'SKU-104' } },
                data: { fulfillmentCapacity: 9999 }
            });
        }

        res.json({ success: true, message: `Demo reset successfully to ${action}` });
        return;
    }

    res.status(400).json({ error: 'Unknown action' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
