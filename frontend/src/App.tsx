import { useState } from 'react'

export default function Dashboard() {
  const [scenario, setScenario] = useState<string>('S1')
  const [running, setRunning] = useState(false)
  const [runId, setRunId] = useState<string | null>(null)
  const [decision, setDecision] = useState<any>(null)
  const [logs, setLogs] = useState<any[]>([])
  const [validationResult, setValidationResult] = useState<any>(null)
  const [generalError, setGeneralError] = useState<string | null>(null)

  const [simulatedChange, setSimulatedChange] = useState<any>(null)

  const handleInvestigate = async () => {
    setRunning(true)
    setDecision(null)
    setLogs([])
    setValidationResult(null)
    setGeneralError(null)
    setSimulatedChange(null)
    try {
      await fetch('/api/scenarios', { method: 'POST', body: JSON.stringify({ action: `RESET_SCENARIO_${scenario.replace('S', '')}` }), headers: { 'Content-Type': 'application/json' } })

      const reqQty = scenario === 'S2' ? 500 : 800;

      const res = await fetch('/api/agent', {
        method: 'POST',
        body: JSON.stringify({
          sku: 'SKU-104',
          nodeId: 'NODE-BOM',
          recommendedQuantity: reqQty
        }),
        headers: { 'Content-Type': 'application/json' }
      })

      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Server error occurred')
      }

      setRunId(data.runId)
      setDecision(data.decision)

      if (data.runId) {
        refreshLogs(data.runId)
      }
    } catch (error: any) {
      setGeneralError(error.message)
    } finally {
      setRunning(false)
    }
  }

  const refreshLogs = async (id: string) => {
    try {
      const res = await fetch(`/api/agent?runId=${id}`)
      const data = await res.json()
      if (data && data.logs) {
        setLogs(data.logs)
      }
    } catch {
      // ignore
    }
  }

  const handleSimulateConflict = async () => {
    await fetch('/api/scenarios', { method: 'POST', body: JSON.stringify({ action: 'REDUCE_BUDGET' }), headers: { 'Content-Type': 'application/json' } })
    setSimulatedChange({
      title: 'BUDGET CHANGED',
      changeStr: '₹8,00,000 → ₹2,50,000',
      versionStr: 'Version: 1 → 2'
    });
  }

  const handleSimulateForecastChange = async () => {
    await fetch('/api/scenarios', { method: 'POST', body: JSON.stringify({ action: 'CHANGE_FORECAST' }), headers: { 'Content-Type': 'application/json' } })
    setSimulatedChange({
      title: 'FORECAST CHANGED',
      changeStr: '610 → 1000',
      versionStr: 'Version: 1 → 2'
    });
  }

  const handleResetDemo = async () => {
    await fetch('/api/scenarios', { method: 'POST', body: JSON.stringify({ action: `RESET_SCENARIO_${scenario.replace('S', '')}` }), headers: { 'Content-Type': 'application/json' } })
    setDecision(null)
    setLogs([])
    setValidationResult(null)
    setGeneralError(null)
    setSimulatedChange(null)
    setRunId(null)
  }

  const handleExecute = async () => {
    if (!runId || !decision) return
    const res = await fetch('/api/execute', {
      method: 'POST',
      body: JSON.stringify({
        runId,
        nodeId: 'NODE-BOM',
        supplierId: decision.proposedSupplierId || 'SUP-001',
        quantity: decision.recommendedQuantity,
        unitCost: 1200 // simulated deterministic parameter 
      }),
      headers: { 'Content-Type': 'application/json' }
    })

    const data = await res.json()
    setValidationResult(data)

    if (!data.success) {
      setRunning(true)
      try {
        const recoverRes = await fetch('/api/agent', {
          method: 'POST',
          body: JSON.stringify({
            sku: 'SKU-104',
            nodeId: 'NODE-BOM',
            recommendedQuantity: decision.recommendedQuantity,
            context: 'RE_INVESTIGATE_AFTER_FAILURE'
          }),
          headers: { 'Content-Type': 'application/json' }
        })
        const recoverData = await recoverRes.json()
        setRunId(recoverData.runId)
        setDecision(recoverData.decision)
        if (recoverData.runId) refreshLogs(recoverData.runId)
      } catch (err: any) {
        setGeneralError(err.message)
      } finally {
        setRunning(false)
      }
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 p-8 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">AI Purchasing Agent</h1>
      </header>

      {generalError && (
        <div className="bg-red-50 text-red-700 p-4 rounded-xl border border-red-200 shadow-sm">
          <strong>Error: </strong> {generalError}
        </div>
      )}

      {simulatedChange && (
        <div className="bg-orange-100 text-orange-800 p-4 rounded-xl border border-orange-300 shadow-sm blink-animation">
          <strong className="text-lg">{simulatedChange.title}</strong>
          <p className="font-mono mt-1">{simulatedChange.changeStr}</p>
          <p className="font-mono text-sm">{simulatedChange.versionStr}</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

        {/* Recommendation Control Card */}
        <div className="md:col-span-1 bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-4">
          <h2 className="text-xl font-semibold">Demo Scenarios</h2>
          <select
            value={scenario}
            onChange={(e) => setScenario(e.target.value)}
            disabled={running}
            className="w-full bg-gray-50 border border-gray-300 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
          >
            <option value="S1">Scenario 1: Recommendation Review</option>
            <option value="S2">Scenario 2: Supplier Partial Fulfillment</option>
            <option value="S3">Scenario 3: Forecast Change</option>
            <option value="S4">Scenario 4: Budget Constraint</option>
          </select>

          <div className="space-y-4 border-l-4 border-blue-500 pl-4 bg-gray-50 p-4 mt-4">
            <h3 className="font-bold">Recommendation Context</h3>
            <p className="text-sm">SKU: SKU-104 (Wireless Earbuds)</p>
            <p className="text-sm">Node: Mumbai Central</p>
            <p className="text-sm font-semibold">
              System Recommends: {scenario === 'S2' ? '500 units' : '800 units'}
            </p>
            <p className="text-xs text-gray-500 italic mt-2">
              {scenario === 'S1' && "Standard happy-path calculation."}
              {scenario === 'S2' && "Primary supplier can only fulfill 250 units."}
              {scenario === 'S3' && "Forecast surges during decision review."}
              {scenario === 'S4' && "Budget reduced during decision review."}
            </p>
          </div>
          <button
            disabled={running}
            onClick={handleInvestigate}
            className="w-full bg-blue-600 text-white font-medium px-4 py-2 rounded shadow hover:bg-blue-700 disabled:opacity-50"
          >
            {running ? "Agent Investigating..." : "Start Investigation"}
          </button>

          <button
            disabled={running}
            onClick={handleResetDemo}
            className="w-full bg-gray-200 text-gray-800 font-medium px-4 py-2 rounded shadow hover:bg-gray-300 disabled:opacity-50 mt-4"
          >
            Reset Demo Database
          </button>
        </div>

        {/* Main Panel */}
        <div className="md:col-span-2 space-y-6">

          {/* Agent Decision */}
          {decision && (
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold">Agent Decision</h2>
                <span className={`px-3 py-1 rounded-full text-sm font-bold ${decision.decision === 'MODIFY' ? 'bg-amber-100 text-amber-700'
                  : decision.decision === 'ACCEPT' ? 'bg-green-100 text-green-700'
                    : 'bg-red-100 text-red-700'
                  }`}>{decision.decision} RECOMMENDATION</span>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-6 pt-2 pb-6 border-b border-gray-100">
                <div>
                  <label className="text-xs text-gray-500 uppercase">Original System Recommendation</label>
                  <p className="text-lg">{scenario === 'S2' ? '500 units' : '800 units'}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-500 uppercase">Agent Recommendation</label>
                  <p className="text-lg font-semibold">{decision.recommendedQuantity} units</p>
                </div>
              </div>

              <h2 className="text-xl font-semibold mb-4">Proposed Action(s)</h2>
              <div className="grid grid-cols-1 gap-4 mb-6">
                {(decision.proposedActions ? (typeof decision.proposedActions === 'string' ? JSON.parse(decision.proposedActions) : decision.proposedActions) : [{
                  action: decision.proposedAction,
                  quantity: decision.recommendedQuantity,
                  unitCost: 1200,
                  supplierId: decision.proposedSupplierId
                }]).map((act: any, idx: number) => (
                  <div key={idx} className="grid grid-cols-4 gap-4 p-4 border rounded bg-gray-50">
                    <div>
                      <label className="text-xs text-gray-500 uppercase">Action {idx + 1}</label>
                      <p className="text-md font-semibold">{act.action}</p>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 uppercase">Supplier</label>
                      <p className="text-md">{act.supplierId || 'N/A'}</p>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 uppercase">Quantity</label>
                      <p className="text-md">{act.quantity} units</p>
                    </div>
                    <div>
                      <label className="text-xs text-gray-500 uppercase">Total</label>
                      <p className="text-md">₹{((Number(act.quantity) || 0) * (Number(act.unitCost) || 0)).toLocaleString()}</p>
                    </div>
                  </div>
                ))}

                {/* Aggregate Summary */}
                <div className="grid grid-cols-4 gap-4 p-4 border-t-2 border-gray-800 bg-gray-100 mt-2">
                  <div>
                    <label className="text-xs text-gray-800 uppercase font-bold">Aggregate</label>
                  </div>
                  <div></div>
                  <div>
                    <label className="text-xs text-gray-800 uppercase font-bold">Total Quantity</label>
                    <p className="text-md font-bold">{(decision.proposedActions ? (typeof decision.proposedActions === 'string' ? JSON.parse(decision.proposedActions) : decision.proposedActions) : [{ quantity: decision.recommendedQuantity }]).reduce((acc: number, act: any) => acc + (Number(act.quantity) || 0), 0)}</p>
                  </div>
                  <div>
                    <label className="text-xs text-gray-800 uppercase font-bold">Total Cost</label>
                    <p className="text-md font-bold">₹{(decision.proposedActions ? (typeof decision.proposedActions === 'string' ? JSON.parse(decision.proposedActions) : decision.proposedActions) : [{ quantity: decision.recommendedQuantity, unitCost: 1200 }]).reduce((acc: number, act: any) => acc + ((Number(act.quantity) || 0) * (Number(act.unitCost) || 0)), 0).toLocaleString()}</p>
                  </div>
                </div>
              </div>

              <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                {decision.evidence && (
                  <div className="bg-gray-50 p-4 rounded border">
                    <label className="text-xs text-gray-500 uppercase font-bold block mb-2">Evidence</label>
                    <ul className="text-sm space-y-2 font-mono">
                      {decision.evidence.inventory && <li><strong>Inventory:</strong><br /> {decision.evidence.inventory}</li>}
                      {decision.evidence.demand && <li><strong>Demand:</strong><br /> {decision.evidence.demand}</li>}
                      {decision.evidence.incoming && <li><strong>Incoming:</strong><br /> {decision.evidence.incoming}</li>}
                      {decision.evidence.supplier && <li><strong>Supplier:</strong><br /> {decision.evidence.supplier}</li>}
                      {decision.evidence.budget && <li><strong>Budget:</strong><br /> {decision.evidence.budget}</li>}
                      {decision.evidence.storage && <li><strong>Storage:</strong><br /> {decision.evidence.storage}</li>}
                    </ul>
                  </div>
                )}

                <div>
                  {decision.evidence?.calculation && (
                    <div className="mb-4">
                      <label className="text-xs text-gray-500 uppercase block mb-1">Calculation Step-by-Step</label>
                      <pre className="text-xs text-gray-700 bg-gray-50 p-2 border rounded whitespace-pre-wrap font-mono">
                        {decision.evidence.calculation}
                      </pre>
                    </div>
                  )}

                  <label className="text-xs text-gray-500 uppercase block mb-1">Reasoning</label>
                  <p className="text-sm leading-relaxed text-gray-700 mb-4">{decision.decisionReasoning}</p>

                  {decision.keyFactors && decision.keyFactors.length > 0 && (
                    <div>
                      <label className="text-xs text-gray-500 uppercase block mb-1">Key factors</label>
                      <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1">
                        {decision.keyFactors.map((kf: string, i: number) => (
                          <li key={i}>{kf}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              <div className="mb-6 p-4 rounded bg-gray-50 border border-gray-200">
                <h3 className="text-sm font-bold uppercase text-gray-700 mb-2">Pre-Action Validation (Simulated)</h3>

                {decision.proposedAction === 'NO_ACTION' ? (
                  <p className="text-gray-500 text-sm font-medium flex items-center">✓ NOT REQUIRED (No purchase action is required.)</p>
                ) : decision.decision !== 'ESCALATE' ? (
                  <div className="space-y-4">
                    <div>
                      <h4 className="text-xs font-bold text-gray-500 uppercase mb-1">Aggregate</h4>
                      <ul className="flex space-x-6 text-sm font-medium">
                        <li className="text-green-600 flex items-center">✓ Total Quantity</li>
                        <li className="text-green-600 flex items-center">✓ Total Budget</li>
                        <li className="text-green-600 flex items-center">✓ Total Storage</li>
                      </ul>
                    </div>

                    {(decision.proposedActions ? (typeof decision.proposedActions === 'string' ? JSON.parse(decision.proposedActions) : decision.proposedActions) : [{ supplierId: decision.proposedSupplierId }]).map((act: any, idx: number) => (
                      <div key={idx}>
                        <h4 className="text-xs font-bold text-gray-500 uppercase mb-1">{act.supplierId || 'Primary Supplier'}</h4>
                        <ul className="flex space-x-6 text-sm font-medium">
                          <li className="text-green-600 flex items-center">✓ Supplier active</li>
                          <li className="text-green-600 flex items-center">✓ MOQ</li>
                          <li className="text-green-600 flex items-center">✓ Capacity</li>
                        </ul>
                      </div>
                    ))}
                  </div>
                ) : (
                  <ul className="flex flex-col space-y-2 text-sm font-medium">
                    <li className="text-green-600 flex items-center">✓ No purchase execution required</li>
                    <li className="text-green-600 flex items-center">✓ No budget commitment</li>
                    <li className="text-green-600 flex items-center">✓ No inventory commitment</li>
                    <li className="text-green-600 flex items-center">✓ Escalation reason recorded</li>
                  </ul>
                )}
              </div>

              <div className="pt-4 border-t flex flex-wrap gap-4">
                <button
                  onClick={handleExecute}
                  disabled={decision.decision === 'ESCALATE'}
                  className="bg-green-600 text-white px-4 py-2 font-medium rounded hover:bg-green-700 disabled:opacity-50"
                >
                  Approve & Execute (Simulate Human)
                </button>
                {scenario === 'S4' && (
                  <button
                    onClick={handleSimulateConflict}
                    className="bg-orange-100 text-orange-700 px-4 py-2 font-medium rounded hover:bg-orange-200"
                  >
                    Simulate Budget Change
                  </button>
                )}
                {scenario === 'S3' && (
                  <button
                    onClick={handleSimulateForecastChange}
                    className="bg-orange-100 text-orange-700 px-4 py-2 font-medium rounded hover:bg-orange-200"
                  >
                    Simulate Forecast Change
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Validation Post-Execution / Execution Revalidation */}
          {validationResult && (
            <div className={`p-6 rounded-xl border shadow-sm ${validationResult.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
              <h2 className="text-xl font-semibold mb-4">
                {validationResult.success ? "Post-Action Validation" : "Execution Validation"}
              </h2>
              <h3 className={`font-mono text-lg ${validationResult.success ? 'text-green-700' : 'text-red-700'}`}>
                {validationResult.success ? "STATUS: SUCCESS" : "STATUS: BLOCKED"}
              </h3>

              {!validationResult.success && validationResult.message && (
                <div className="mt-4 p-4 rounded text-sm bg-red-100 text-red-800 border border-red-300">
                  <strong>Message:</strong> {validationResult.message}
                </div>
              )}

              {validationResult.success && validationResult.postValidation && (
                <div className="mt-4 bg-white p-4 rounded text-sm overflow-auto font-mono text-green-800">
                  {JSON.stringify(validationResult.postValidation.checks, null, 2)}
                </div>
              )}

              {!validationResult.success && validationResult.validation && (
                <div className="mt-4 bg-white p-4 rounded text-sm overflow-auto font-mono text-red-600">
                  {JSON.stringify(validationResult.validation.checks, null, 2)}
                </div>
              )}
            </div>
          )}

          {/* Audit Timeline */}
          {
            logs.length > 0 && (
              <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
                <h2 className="text-xl font-semibold mb-6">Execution & Tool Activity</h2>
                <div className="space-y-4">
                  {logs.map((log, i) => (
                    <div key={i} className="flex border-l-2 border-gray-100 pl-4 py-2 space-x-4 items-start text-sm">
                      <span className="text-gray-400 font-mono w-24 shrink-0 text-xs mt-1">
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </span>
                      <div>
                        <p className="font-semibold text-gray-800">{log.toolName}</p>
                        <pre className="text-xs text-gray-500 overflow-hidden bg-gray-50 p-2 mt-1 rounded border">
                          {log.resultSummary}
                        </pre>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          }

        </div >
      </div >
    </div >
  )
}
