import { prisma } from '../services/prisma'
import { calculateInventoryGap } from '../services/calculations'

// Fixing the import path internally
import { validatePurchaseAction as vPA } from '../validators/validation'

export async function executeTool(runId: string, functionName: string, argsString: string) {
    let args: Record<string, any> = {}
    try {
        args = JSON.parse(argsString)
    } catch (e) { }

    let resultSummary = ''

    try {
        if (functionName === 'getInventory') {
            const inv = await prisma.inventory.findUnique({
                where: { sku_nodeId: { sku: args['sku'], nodeId: args['nodeId'] } }
            })
            if (inv) {
                resultSummary = JSON.stringify({
                    currentQuantity: inv.currentQuantity,
                    reservedQuantity: inv.reservedQuantity,
                    availableQuantity: inv.currentQuantity - inv.reservedQuantity,
                    reorderPoint: inv.reorderPoint,
                    safetyStock: inv.safetyStock,
                    dailyAverageDemand: inv.dailyAverageDemand
                })
            } else {
                resultSummary = '{"error":"Inventory not found"}'
            }
        } else if (functionName === 'getDemandForecast') {
            const fc = await prisma.forecast.findUnique({ where: { sku_nodeId: { sku: args['sku'], nodeId: args['nodeId'] } } })
            const dh = await prisma.demandHistory.findUnique({ where: { sku_nodeId: { sku: args['sku'], nodeId: args['nodeId'] } } })
            resultSummary = JSON.stringify({ forecast: fc, historicalTrend: dh })
        } else if (functionName === 'getOpenPurchaseOrders') {
            const pos = await prisma.purchaseOrder.findMany({
                where: { sku: args['sku'], nodeId: args['nodeId'], status: { in: ['PENDING', 'CONFIRMED'] } }
            })
            resultSummary = JSON.stringify(pos)
        } else if (functionName === 'getSupplier') {
            const sup = await prisma.supplier.findUnique({ where: { supplierId: args['supplierId'] } })
            resultSummary = sup ? JSON.stringify(sup) : '{"error":"not found"}'
        } else if (functionName === 'getAlternativeSuppliers') {
            const sps = await prisma.supplierProduct.findMany({
                where: { sku: args['sku'] },
                include: { supplier: true }
            })
            resultSummary = JSON.stringify(sps.filter((sp: any) => sp.supplier.status === 'ACTIVE').map((sp: any) => ({
                supplierId: sp.supplierId,
                name: sp.supplier.name,
                leadTimeDays: sp.supplier.leadTimeDays,
                minimumOrderQuantity: sp.supplier.minimumOrderQuantity,
                unitCost: sp.unitCost,
                fulfillmentCapacity: sp.fulfillmentCapacity
            })))
        } else if (functionName === 'getBudget') {
            const b = await prisma.budget.findUnique({ where: { nodeId: args['nodeId'] } })
            resultSummary = b ? JSON.stringify(b) : '{"error":"not found"}'
        } else if (functionName === 'getStorageCapacity') {
            const s = await prisma.storage.findUnique({ where: { nodeId: args['nodeId'] } })
            resultSummary = s ? JSON.stringify(s) : '{"error":"not found"}'
        } else if (functionName === 'calculatePurchaseRequirement') {
            const res = await calculateInventoryGap(args['sku'], args['nodeId'], args['coverageDays'])
            resultSummary = JSON.stringify(res)
        } else if (functionName === 'validatePurchaseAction') {
            const res = await vPA(args['nodeId'], args['actions'] || [
                { supplierId: args['supplierId'], quantity: args['quantity'], unitCost: args['unitCost'], action: args['action'] || 'CREATE_PO' }
            ])
            resultSummary = JSON.stringify(res)
        } else {
            resultSummary = '{"error":"unknown function"}'
        }
    } catch (err: any) {
        resultSummary = `{"error":"${err.message}"}`
    }

    // Persist tool call
    await prisma.toolCall.create({
        data: {
            runId,
            toolName: functionName,
            inputSummary: JSON.stringify(args),
            resultSummary
        }
    })

    return resultSummary
}
