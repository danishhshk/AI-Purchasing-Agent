import { describe, it, expect } from 'vitest'
import { requiresHumanApproval } from '../../src/validators/validation'

describe('Purchasing Validation Engine', () => {

    it('correctly assesses human approval thresholds', () => {
        // Over 10k block
        expect(requiresHumanApproval(12000)).toBe(true)

        // Under 10k ok
        expect(requiresHumanApproval(8000)).toBe(false)
    })

})
