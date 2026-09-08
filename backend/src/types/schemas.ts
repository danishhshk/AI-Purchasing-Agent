import { z } from 'zod'

export const agentToolsSchema = [
    {
        type: 'function',
        function: {
            name: 'getInventory',
            description: 'Get current inventory and stock parameters for a specific product at a node.',
            parameters: {
                type: 'object',
                properties: {
                    sku: { type: 'string' },
                    nodeId: { type: 'string' }
                },
                required: ['sku', 'nodeId']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'getDemandForecast',
            description: 'Get demand forecast for a product and historical demand trends.',
            parameters: {
                type: 'object',
                properties: {
                    sku: { type: 'string' },
                    nodeId: { type: 'string' }
                },
                required: ['sku', 'nodeId']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'getOpenPurchaseOrders',
            description: 'Get existing incoming purchase orders for a product at a node.',
            parameters: {
                type: 'object',
                properties: {
                    sku: { type: 'string' },
                    nodeId: { type: 'string' }
                },
                required: ['sku', 'nodeId']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'getSupplier',
            description: 'Get details for a specific supplier by ID.',
            parameters: {
                type: 'object',
                properties: {
                    supplierId: { type: 'string' }
                },
                required: ['supplierId']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'getAlternativeSuppliers',
            description: 'Get alternative active suppliers for a specific product SKU.',
            parameters: {
                type: 'object',
                properties: {
                    sku: { type: 'string' }
                },
                required: ['sku']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'getBudget',
            description: 'Get budget status for a given fulfillment node.',
            parameters: {
                type: 'object',
                properties: {
                    nodeId: { type: 'string' }
                },
                required: ['nodeId']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'getStorageCapacity',
            description: 'Get storage capacity metrics for a given fulfillment node.',
            parameters: {
                type: 'object',
                properties: {
                    nodeId: { type: 'string' }
                },
                required: ['nodeId']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'calculatePurchaseRequirement',
            description: 'Deterministically calculate inventory gap (missing inventory units) over a specific coverage period.',
            parameters: {
                type: 'object',
                properties: {
                    sku: { type: 'string' },
                    nodeId: { type: 'string' },
                    coverageDays: { type: 'number' }
                },
                required: ['sku', 'nodeId', 'coverageDays']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'validatePurchaseAction',
            description: 'Deterministically check if a proposed purchase structurally meets budget, storage, MOQ, and supplier status constraints.',
            parameters: {
                type: 'object',
                properties: {
                    nodeId: { type: 'string' },
                    supplierId: { type: 'string' },
                    quantity: { type: 'number' },
                    unitCost: { type: 'number' }
                },
                required: ['nodeId', 'supplierId', 'quantity', 'unitCost']
            }
        }
    }
]

export const DecisionSchema = z.object({
    decision: z.enum(['ACCEPT', 'MODIFY', 'REJECT', 'ESCALATE', 'WAIT', 'SOURCE_ALTERNATIVE', 'CREATE_SUPPLEMENTAL_PO']),
    recommendedQuantity: z.number().nullable(),
    confidence: z.number(),
    decisionReasoning: z.string(),
    proposedAction: z.enum(['NO_ACTION', 'CREATE_PO', 'MODIFY_PO', 'ESCALATE']),
    proposedSupplierId: z.string().nullable(),
    evidence: z.object({
        inventory: z.string().optional(),
        demand: z.string().optional(),
        incoming: z.string().optional(),
        supplier: z.string().optional(),
        budget: z.string().optional(),
        storage: z.string().optional()
    }).optional(),
    keyFactors: z.array(z.string()).optional()
})
