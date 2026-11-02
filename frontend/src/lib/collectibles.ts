// Mirrors backend/src/services/collectibles.rs so forms can preview what the server will record.

/** Splits `total` cents across items by weight (estimated value); parts add up exactly. Even split if all weights are 0. */
export function allocate(total: number, weights: number[]): number[] {
  const n = weights.length
  if (n === 0) return []
  const w = weights.every((x) => x <= 0) ? weights.map(() => 1) : weights.map((x) => Math.max(0, x))
  const sum = w.reduce((s, x) => s + x, 0)
  const parts = w.map((x) => Math.floor((total * x) / sum))
  let leftover = total - parts.reduce((s, x) => s + x, 0)
  const order = w.map((_, i) => i).sort((a, b) => ((total * w[b]) % sum) - ((total * w[a]) % sum))
  for (let k = 0; leftover > 0; k = (k + 1) % n, leftover--) parts[order[k]] += 1
  return parts
}

/** Received items take over the cost of what was given (+ cash added − cash received); extra cash is profit. */
export function tradeBasis(outgoingCost: number, cashOut: number, cashIn: number): { incomingCost: number; gain: number } {
  const net = outgoingCost + cashOut - cashIn
  return net >= 0 ? { incomingCost: net, gain: 0 } : { incomingCost: 0, gain: -net }
}
