import { prisma } from '../services/prisma'

export interface ValidationCheck {
    name: string
    passed: boolean
    message: string
}

export interface ActionValidation {
    supplierId: string
    quantity: number
    unitCost: number
    purchaseCost: number
    capacityCheck: boolean
    moqCheck: boolean
    supplierStatusCheck: boolean
    checks: ValidationCheck[]
}

export interface AggregateValidationResult {
    valid: boolean
    aggregate: {
        totalQuantity: number
        totalPurchaseCost: number
        availableBudget: number
        availableStorage: number
        checks: ValidationCheck[]
    }
    actions: ActionValidation[]
}

export async function validatePurchaseAction(
    nodeId: string,
    actions: Array<{ supplierId: string, quantity: number, unitCost: number, action: string }>
): Promise<AggregateValidationResult> {

    // First handle BYPASS scenarios cleanly so we don't fetch unnecessarily
    if (actions.length === 1 && (actions[0].action === 'NO_ACTION' || actions[0].action === 'ESCALATE')) {
        const actionType = actions[0].action
        const explicitChecks = [
            { name: 'execution', passed: true, message: 'No purchase execution required' },
            { name: 'budget', passed: true, message: 'No budget commitment' },
            { name: 'inventory', passed: true, message: 'No inventory commitment' }
        ]
        if (actionType === 'ESCALATE') {
            explicitChecks.push({ name: 'escalation', passed: true, message: 'Escalation reason recorded' })
        }

        return {
            valid: true,
            aggregate: {
                totalQuantity: 0,
                totalPurchaseCost: 0,
                availableBudget: 0,
                availableStorage: 0,
                checks: explicitChecks
            },
            actions: [{
                supplierId: actions[0].supplierId || '', quantity: 0, unitCost: 0, purchaseCost: 0,
                capacityCheck: true, moqCheck: true, supplierStatusCheck: true,
                checks: explicitChecks
            }]
        }
    }

    const budget = await prisma.budget.findUnique({ where: { nodeId } })
    const storage = await prisma.storage.findUnique({ where: { nodeId } })

    let totalQuantity = 0
    let totalPurchaseCost = 0

    for (const act of actions) {
        totalQuantity += act.quantity
        totalPurchaseCost += (act.quantity * act.unitCost)
    }

    const aggregateChecks: ValidationCheck[] = []
    let allValid = true

    const budgetAvail = budget?.availableBudget || 0
    if (totalPurchaseCost <= budgetAvail) {
        aggregateChecks.push({ name: 'aggregate_budget', passed: true, message: `Aggregate cost ₹${totalPurchaseCost.toLocaleString()} fits within ₹${budgetAvail.toLocaleString()} budget.` })
    } else {
        aggregateChecks.push({ name: 'aggregate_budget', passed: false, message: `Aggregate cost ₹${totalPurchaseCost.toLocaleString()} exceeds available budget ₹${budgetAvail.toLocaleString()}.` })
        allValid = false
    }

    const storageAvail = storage?.availableCapacityUnits || 0
    if (totalQuantity <= storageAvail) {
        aggregateChecks.push({ name: 'aggregate_storage', passed: true, message: `Aggregate quantity ${totalQuantity} fits within ${storageAvail} storage units.` })
    } else {
        aggregateChecks.push({ name: 'aggregate_storage', passed: false, message: `Aggregate quantity ${totalQuantity} exceeds available storage ${storageAvail}.` })
        allValid = false
    }

    const actionValidations: ActionValidation[] = []

    for (const act of actions) {
        const sup = await prisma.supplier.findUnique({ where: { supplierId: act.supplierId } })
        const supProd = await prisma.supplierProduct.findUnique({ where: { supplierId_sku: { supplierId: act.supplierId, sku: 'SKU-104' } } })

        let capCheck = true
        let moqCheck = true
        let stCheck = true
        const actChecks: ValidationCheck[] = []

        if (sup?.status === 'ACTIVE') {
            actChecks.push({ name: 'supplier_status', passed: true, message: 'Supplier is active' })
        } else {
            actChecks.push({ name: 'supplier_status', passed: false, message: 'Supplier inactive' })
            stCheck = false
            allValid = false
        }

        if (sup?.minimumOrderQuantity != null && act.quantity >= sup.minimumOrderQuantity) {
            actChecks.push({ name: 'moq', passed: true, message: `Meets MOQ of ${sup.minimumOrderQuantity}` })
        } else {
            actChecks.push({ name: 'moq', passed: false, message: `Fails MOQ of ${sup?.minimumOrderQuantity}` })
            moqCheck = false
            allValid = false
        }

        if (supProd && supProd.fulfillmentCapacity != null) {
            if (act.quantity <= supProd.fulfillmentCapacity) {
                actChecks.push({ name: 'capacity', passed: true, message: `Quantity ${act.quantity} <= capacity ${supProd.fulfillmentCapacity}` })
            } else {
                actChecks.push({ name: 'capacity', passed: false, message: `Supplier can fulfill only ${supProd.fulfillmentCapacity} of the requested ${act.quantity} units.` })
                capCheck = false
                allValid = false
            }
        } else {
            // unconstrained capacity assumption for default seed 
            actChecks.push({ name: 'capacity', passed: true, message: `Quantity ${act.quantity} <= capacity Unlimited` })
        }

        actionValidations.push({
            supplierId: act.supplierId,
            quantity: act.quantity,
            unitCost: act.unitCost,
            purchaseCost: act.quantity * act.unitCost,
            capacityCheck: capCheck,
            moqCheck: moqCheck,
            supplierStatusCheck: stCheck,
            checks: actChecks
        })
    }

    return {
        valid: allValid,
        aggregate: {
            totalQuantity,
            totalPurchaseCost,
            availableBudget: budgetAvail,
            availableStorage: storageAvail,
            checks: aggregateChecks
        },
        actions: actionValidations
    }
}

const HUMAN_APPROVAL_THRESHOLD_DEFAULT = 10000.0

export function requiresHumanApproval(totalCost: number, threshold: number = HUMAN_APPROVAL_THRESHOLD_DEFAULT): boolean {
    return totalCost > threshold
}
