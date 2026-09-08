import { prisma } from './prisma'

export interface InventoryGapResult {
    sku: string
    nodeId: string
    availableInventory: number
    confirmedIncomingInventory: number
    forecastDemand: number
    projectedInventory: number
    requiredInventory: number
    safetyStock: number
    inventoryGap: number
    surplusIfGapNegative: number
    error?: string
}

export async function calculateInventoryGap(sku: string, nodeId: string, coverageDays: number): Promise<InventoryGapResult> {
    const inventory = await prisma.inventory.findUnique({
        where: { sku_nodeId: { sku, nodeId } }
    })

    if (!inventory) {
        throw new Error("Inventory not found")
    }

    const availableInventory = inventory.currentQuantity - inventory.reservedQuantity

    // Get active purchase orders
    const openPos = await prisma.purchaseOrder.findMany({
        where: {
            sku,
            nodeId,
            status: { in: ['PENDING', 'CONFIRMED'] }
        }
    })

    const confirmedIncomingInventory = openPos.reduce((sum: number, po: any) => sum + po.quantity, 0)

    const forecast = await prisma.forecast.findUnique({
        where: { sku_nodeId: { sku, nodeId } }
    })

    let forecastDemand = 0
    if (forecast) {
        if (coverageDays <= 3) forecastDemand = forecast.next3Days
        else if (coverageDays <= 5) forecastDemand = forecast.next5Days
        else if (coverageDays <= 7) forecastDemand = forecast.next7Days
        else forecastDemand = forecast.next14Days
    } else {
        forecastDemand = inventory.dailyAverageDemand * coverageDays
    }

    // Documented Formula:
    // Available Inventory = Current Inventory - Reserved Inventory
    // Required Inventory = Demand During Coverage Period (forecastDemand) + Safety Stock
    // Net Requirement = Required Inventory - Available Inventory - Confirmed Incoming Inventory
    // Purchase Quantity = max(Net Requirement, 0)

    const requiredInventory = forecastDemand + inventory.safetyStock
    const netRequirement = requiredInventory - availableInventory - confirmedIncomingInventory

    return {
        sku,
        nodeId,
        availableInventory,
        confirmedIncomingInventory,
        forecastDemand,
        projectedInventory: availableInventory + confirmedIncomingInventory - forecastDemand,
        requiredInventory,
        safetyStock: inventory.safetyStock,
        inventoryGap: Math.max(0, netRequirement),
        surplusIfGapNegative: Math.max(0, -netRequirement)
    }
}
