/**
 * Codeforces-style Expected Rank Rating System
 * 
 * Instead of pairwise decomposition (N*(N-1)/2 virtual duels),
 * this computes a single expected rank for each player and compares
 * it to their actual rank.
 * 
 * Formula:
 *   expectedRank[i] = 1 + Σ(j≠i) P(j beats i)
 *   P(j beats i) = 1 / (1 + 10^((Ri - Rj) / 400))
 *   delta[i] = K * (expectedRank[i] - actualRank[i])
 * 
 * Benefits over pairwise Elo:
 *   - Treats game as one multiplayer event, not decomposed duels
 *   - Rating change scales naturally (no inflation in large games)
 *   - Same math used by Codeforces, Kaggle, and esports ladders
 */

import { getKFactor } from './elo'

/**
 * Calculate the probability that player j beats player i.
 * Same logistic function as Elo, but used differently.
 */
function pBeat(ratingJ: number, ratingI: number): number {
  return 1 / (1 + Math.pow(10, (ratingI - ratingJ) / 400))
}

/**
 * Calculate expected rank for a player given the full field.
 * expectedRank = 1 + Σ(j≠i) P(j beats i)
 * 
 * @param playerRating - The player's rating
 * @param opponentRatings - Array of opponent ratings (self already excluded)
 */
export function getExpectedRank(
  playerRating: number,
  opponentRatings: number[]
): number {
  let expected = 1
  for (const otherRating of opponentRatings) {
    expected += pBeat(otherRating, playerRating)
  }
  return expected
}

/**
 * Calculate CF-style rating changes for a multiplayer game.
 * 
 * @param players - Array of { id, rating, gamesPlayed, position }
 *   where position is the actual finishing position (1 = winner)
 * @returns Record<string, number> - rating change per player ID (rounded)
 */
export function calculateCFChanges(
  players: { id: string; rating: number; gamesPlayed: number; position: number }[]
): Record<string, number> {
  const changes: Record<string, number> = {}
  const allRatings = players.map(p => p.rating)

  for (const player of players) {
    // Calculate expected rank (1-indexed)
    let expectedRank = 1
    for (const other of players) {
      if (other.id === player.id) continue
      expectedRank += pBeat(other.rating, player.rating)
    }

    // K-factor (same dynamic decay as Elo)
    const k = getKFactor(player.gamesPlayed)

    // Delta = K * (expectedRank - actualRank)
    // If you finish BETTER than expected → positive (expectedRank > actualRank)
    // If you finish WORSE than expected → negative (expectedRank < actualRank)
    const delta = k * (expectedRank - player.position)

    changes[player.id] = Math.round(delta)
  }

  return changes
}
