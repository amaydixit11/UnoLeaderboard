/**
 * OpenSkill Wrapper
 * 
 * Wraps the `openskill` npm package for GLEU's multiplayer rating.
 * Uses the Plackett-Luce model under a Bayesian mu/sigma framework.
 * 
 * Each player has:
 *   mu (μ)    — estimated skill (starts at 25)
 *   sigma (σ) — uncertainty (starts at 8.33, decays as more games are played)
 *   ordinal   — conservative display rating = μ - 3σ (scaled to ~1000 range)
 */

import { rating, rate, ordinal } from 'openskill'

export type OSRating = { mu: number; sigma: number }

const SCALE = 40      // Multiply ordinal to get ~Elo-like numbers
const OFFSET = 1000   // Center around 1000

/**
 * Create a new OpenSkill rating (for new players).
 */
export function newOSRating(): OSRating {
  return rating()
}

/**
 * Convert mu/sigma to a display-friendly integer rating.
 * ordinal(r) = mu - 3*sigma (conservative estimate)
 * Then scale to be comparable to Elo (~1000 center).
 */
export function osOrdinal(r: OSRating): number {
  return Math.round(ordinal(r) * SCALE + OFFSET)
}

/**
 * Process a multiplayer game result.
 * 
 * @param players - Array of { id, mu, sigma, position }
 *   Sorted or unsorted — positions determine ranking.
 * @returns Updated ratings + changes per player
 */
export function calculateOSChanges(
  players: { id: string; mu: number; sigma: number; position: number }[]
): Record<string, { mu: number; sigma: number; ordinal: number; change: number }> {
  // Sort by position (rank 1 = best, ascending)
  const sorted = [...players].sort((a, b) => a.position - b.position)

  // Build teams array for openskill (each player is a 1-person team)
  const teams = sorted.map(p => [rating({ mu: p.mu, sigma: p.sigma })])

  // Handle ties: build rank array where tied players share the same rank
  const ranks: number[] = []
  for (let i = 0; i < sorted.length; i++) {
    // Find first occurrence of this position
    const firstIdx = sorted.findIndex(s => s.position === sorted[i].position)
    ranks.push(firstIdx + 1) // 1-indexed rank
  }

  // Rate with explicit rank array to handle ties
  const updated = rate(teams, { rank: ranks })

  // Map back to player IDs
  const results: Record<string, { mu: number; sigma: number; ordinal: number; change: number }> = {}
  for (let i = 0; i < sorted.length; i++) {
    const player = sorted[i]
    const newRating = updated[i][0]
    const oldOrd = osOrdinal({ mu: player.mu, sigma: player.sigma })
    const newOrd = osOrdinal(newRating)

    results[player.id] = {
      mu: newRating.mu,
      sigma: newRating.sigma,
      ordinal: newOrd,
      change: newOrd - oldOrd,
    }
  }

  return results
}
