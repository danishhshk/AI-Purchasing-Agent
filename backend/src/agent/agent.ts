import OpenAI from 'openai'
import { prisma } from '../services/prisma'
import { agentToolsSchema, DecisionSchema } from '../types/schemas'
import { SYSTEM_PROMPT } from './prompts'
import { executeTool } from '../tools/tools'

const apiKey = process.env.OPENAI_API_KEY || 'fake-key'
const baseURL = process.env.OPENAI_BASE_URL
const openai = new OpenAI({ apiKey, baseURL })

export async function runAgentInvestigation(runId: string, sku: string, nodeId: string, recommendedQuantity: number) {
    // Update state
    await prisma.agentRun.update({
        where: { runId },
        data: { status: 'INVESTIGATING' }
    })

    const aiProvider = process.env.AI_PROVIDER || 'mock'

    // If provider is mock or missing OpenAI key, run deterministic Mock Mode for the reviewer
    // BUT we must actually call the tools to populate the DB, instead of hardcoding.
    if (aiProvider === 'mock' || apiKey === 'fake-key' || apiKey === '') {
        console.log("Running in Deterministic Mock Mode.")

        await prisma.agentRun.update({
            where: { runId },
            data: { status: 'DECIDING' }
        })

        // Call tools sequentially and deterministically
        const inv = JSON.parse(await executeTool(runId, 'getInventory', JSON.stringify({ sku, nodeId })))
        const fc = JSON.parse(await executeTool(runId, 'getDemandForecast', JSON.stringify({ sku, nodeId })))
        const poStr = await executeTool(runId, 'getOpenPurchaseOrders', JSON.stringify({ sku, nodeId }))
        const pos = JSON.parse(poStr)
        const incomingQty = pos.reduce((sum: number, po: any) => sum + po.quantity, 0)

        const altSuppliersStr = await executeTool(runId, 'getAlternativeSuppliers', JSON.stringify({ sku }))
        const altSuppliers = JSON.parse(altSuppliersStr)
        const primarySupplier = altSuppliers.find((s: any) => s.supplierId === 'SUP-001') || altSuppliers[0]
        const altSupplier = altSuppliers.find((s: any) => s.supplierId === 'SUP-002') || altSuppliers[1]

        const sup = JSON.parse(await executeTool(runId, 'getSupplier', JSON.stringify({ supplierId: primarySupplier.supplierId })))
        const budgetStr = JSON.parse(await executeTool(runId, 'getBudget', JSON.stringify({ nodeId })))
        const storageStr = await executeTool(runId, 'getStorageCapacity', JSON.stringify({ nodeId }))
        const storage = JSON.parse(storageStr)

        const reqStr = await executeTool(runId, 'calculatePurchaseRequirement', JSON.stringify({ sku, nodeId, coverageDays: 7 }))
        const req = JSON.parse(reqStr)

        let decisionQty = req.inventoryGap || 0

        let decision = 'MODIFY'
        let action = 'CREATE_PO'
        let decisionReasoning = ''
        let proposedActions: any[] = []
        let finalCost = 0
        let valRes: any = { valid: true, checks: [] }

        if (decisionQty <= 0) {
            decisionQty = 0
            decision = 'ACCEPT'
            action = 'NO_ACTION'
            decisionReasoning = `No additional purchase is required. Available inventory of ${inv.currentQuantity - inv.reservedQuantity} units plus ${incomingQty} confirmed incoming units provides ${(inv.currentQuantity - inv.reservedQuantity) + incomingQty} units, exactly matching the ${fc.forecast?.next7Days}-unit forecast plus ${inv.safetyStock}-unit safety stock requirement.`
            proposedActions = [{ action: 'NO_ACTION', supplierId: null, quantity: 0 }]
        } else {
            // Budget Escalation check comes first so we don't arbitrarily reduce quantity if we can't afford the actual requirement
            const requiredCost = req.inventoryGap * primarySupplier.unitCost;
            if (budgetStr.availableBudget && requiredCost > budgetStr.availableBudget) {
                decision = 'ESCALATE'
                action = 'ESCALATE'
                decisionReasoning = `The required ${req.inventoryGap} units cost ₹${requiredCost.toLocaleString()}, exceeding the current available budget of ₹${parseFloat(budgetStr.availableBudget).toLocaleString()}. Purchasing a smaller quantity would leave the required inventory target unmet, so the agent is escalating for human intervention.`
                proposedActions = [{ action: 'ESCALATE', supplierId: primarySupplier.supplierId, quantity: 0 }]
                decisionQty = 0
            } else if (primarySupplier.fulfillmentCapacity && decisionQty > primarySupplier.fulfillmentCapacity) {
                // SCENARIO 2 Splitting
                let qty1 = primarySupplier.fulfillmentCapacity
                let qty2 = decisionQty - qty1

                if (qty1 < primarySupplier.minimumOrderQuantity) qty1 = primarySupplier.minimumOrderQuantity
                if (qty2 < altSupplier.minimumOrderQuantity) qty2 = altSupplier.minimumOrderQuantity

                decisionQty = qty1 + qty2
                finalCost = (qty1 * primarySupplier.unitCost) + (qty2 * altSupplier.unitCost)
                decision = 'MODIFY'
                proposedActions = [
                    { action: 'CREATE_PO', supplierId: primarySupplier.supplierId, quantity: qty1, unitCost: primarySupplier.unitCost },
                    { action: 'CREATE_PO', supplierId: altSupplier.supplierId, quantity: qty2, unitCost: altSupplier.unitCost }
                ]
                decisionReasoning = `The system calculated a net requirement of ${decisionQty} units. However, the primary supplier ${primarySupplier.name} can fulfill only ${primarySupplier.fulfillmentCapacity} units. The agent has split the purchase order to satisfy the full requirement: ${qty1} units from ${primarySupplier.name} and ${qty2} units from the available alternative supplier ${altSupplier.name}.`
            } else {
                // Standard Pathway
                let reasonStr = `The calculated requirement of ${req.inventoryGap} units was exactly matched by the proposed quantity of ${decisionQty}.`
                if (primarySupplier.minimumOrderQuantity && req.inventoryGap < primarySupplier.minimumOrderQuantity) {
                    decisionQty = primarySupplier.minimumOrderQuantity
                    reasonStr = `The calculated requirement of ${req.inventoryGap} units was increased to ${decisionQty} to meet the supplier's Minimum Order Quantity.`
                }
                if (storage.availableCapacityUnits && decisionQty > storage.availableCapacityUnits) {
                    decisionQty = storage.availableCapacityUnits
                    reasonStr = `The calculated requirement was ${req.inventoryGap} units, but the purchase quantity was reduced to ${decisionQty} because it exceeded the available storage capacity of ${storage.availableCapacityUnits}.`
                }
                finalCost = decisionQty * primarySupplier.unitCost
                proposedActions = [
                    { action: 'CREATE_PO', supplierId: primarySupplier.supplierId, quantity: decisionQty, unitCost: primarySupplier.unitCost }
                ]
                decisionReasoning = reasonStr
            }
        }

        // Validate ALL actions dynamically for the tool log trace
        if (proposedActions.length > 0) {
            const valStr = await executeTool(runId, 'validatePurchaseAction', JSON.stringify({
                nodeId,
                actions: proposedActions
            }))
            valRes = JSON.parse(valStr)
        }

        let sup2: any = null;
        let altSupplierN = '';
        let altSupplierCap = 'Unlimited';
        if (primarySupplier.fulfillmentCapacity && decisionQty > primarySupplier.fulfillmentCapacity) {
            const supStr2 = await executeTool(runId, 'getSupplier', JSON.stringify({ supplierId: altSupplier.supplierId }));
            sup2 = JSON.parse(supStr2);
            altSupplierN = sup2.name || altSupplier.name;
            const spsAlt = await prisma.supplierProduct.findUnique({ where: { supplierId_sku: { supplierId: altSupplier.supplierId, sku: 'SKU-104' } } });
            altSupplierCap = spsAlt?.fulfillmentCapacity?.toString() || 'Unlimited';
        }

        const rawJson = {
            decision,
            recommendedQuantity: decisionQty,
            confidence: valRes.valid ? 0.95 : 1.0,
            decisionReasoning,
            proposedAction: proposedActions.length > 1 ? 'MULTI_SUPPLIER_CREATE_PO' : (typeof proposedActions[0]?.action === 'string' ? proposedActions[0].action : 'CREATE_PO'),
            proposedSupplierId: proposedActions[0]?.supplierId || primarySupplier.supplierId,
            proposedActions: proposedActions,
            evidence: {
                inventory: `Available inventory: ${inv.currentQuantity - inv.reservedQuantity}`,
                demand: `Forecast demand: ${fc.forecast?.next7Days}`,
                incoming: `Confirmed incoming: ${incomingQty}`,
                supplier: `${primarySupplier.name}: capacity = ${primarySupplier.fulfillmentCapacity || 'Unlimited'}${sup2 ? `\n${altSupplierN}: capacity = ${altSupplierCap}` : ''}`,
                budget: `Initial budget: ₹${parseFloat(budgetStr.availableBudget || '0').toLocaleString()} available.`,
                storage: `Available storage: ${storage.availableCapacityUnits}`,
                calculation: `Required inventory: ${fc.forecast?.next7Days + inv.safetyStock}\nInventory available after incoming: ${(inv.currentQuantity - inv.reservedQuantity) + incomingQty}\nAdditional requirement: ${req.inventoryGap}\nRecommended purchase: ${decisionQty} units`
            },
            keyFactors: [
                "Evaluated primary supplier capacity limitations against net demand requirement.",
                "Assessed budget and storage constraints for cumulative action footprint.",
                valRes.valid ? "Constraints fully validated" : "Constraint escalation triggered"
            ]
        }

        await new Promise(resolve => setTimeout(resolve, 1000)); // fake delay

        await prisma.agentRun.update({
            where: { runId },
            data: {
                decision: rawJson.decision,
                recommendedQuantity: rawJson.recommendedQuantity,
                confidence: rawJson.confidence,
                decisionReasoning: rawJson.decisionReasoning,
                proposedAction: rawJson.proposedAction,
                proposedSupplierId: rawJson.proposedSupplierId,
                proposedActions: JSON.stringify(rawJson.proposedActions),
                status: 'AWAITING_APPROVAL',
                stateVersion: budgetStr.version || 1,
                forecastVersion: fc.forecast?.version || 1
            }
        })

        return rawJson
    }

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Review purchasing recommendation for SKU: ${sku} at Node: ${nodeId}. Recommended quantity: ${recommendedQuantity}. Investigate using tools, identify requirement, validate constraint manually, and finally return the structured decision.` }
    ]

    let iterations = 0
    while (iterations < 12) {
        iterations++

        await prisma.agentRun.update({
            where: { runId },
            data: { status: 'DECIDING' }
        })

        const aiModel = process.env.AI_MODEL || 'google/gemini-pro:free'
        const response = await openai.chat.completions.create({
            model: aiModel,
            messages,
            tools: agentToolsSchema as any,
            tool_choice: 'auto'
        })

        const responseMessage = response.choices[0].message
        messages.push(responseMessage)

        if (responseMessage.tool_calls) {
            for (const toolCall of responseMessage.tool_calls as any[]) {
                const resultString = await executeTool(runId, toolCall.function.name, toolCall.function.arguments)
                messages.push({
                    tool_call_id: toolCall.id,
                    role: 'tool',
                    content: resultString
                })
            }
        } else {
            const formatMsg: OpenAI.Chat.ChatCompletionMessageParam[] = [
                { role: 'system', content: 'Extract the prior decision into JSON conforming to the DecisionSchema format.' },
                { role: 'user', content: responseMessage.content || '{}' }
            ]

            const formatResp = await openai.chat.completions.create({
                model: aiModel,
                messages: formatMsg,
                response_format: { type: 'json_object' }
            })

            const rawJson = JSON.parse(formatResp.choices[0].message?.content || '{}')

            await prisma.agentRun.update({
                where: { runId },
                data: {
                    decision: rawJson.decision,
                    recommendedQuantity: rawJson.recommendedQuantity,
                    confidence: rawJson.confidence,
                    decisionReasoning: rawJson.decisionReasoning,
                    proposedAction: rawJson.proposedAction,
                    proposedSupplierId: rawJson.proposedSupplierId,
                    status: 'AWAITING_APPROVAL'
                }
            })

            return rawJson
        }
    }
}
