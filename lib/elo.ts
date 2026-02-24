/**
 * Dynamic K-factor using exponential decay.
 * 
 * K(n) = K_MIN + (K_MAX - K_MIN) * e^(-n / DECAY_RATE)
 * 
 * - K_MAX (32): Starting K for brand-new players (volatile ratings)
 * - K_MIN (16): Floor K for veterans (stable ratings)
 * - DECAY_RATE (20): Controls how quickly K drops. At 20 games, K ≈ 22.
 * 
 * Curve:  0 games → 32 | 10 → 26 | 20 → 22 | 50 → 17 | 100 → 16
 */
export const K_MIN = 16
export const K_MAX = 32
export const K_DECAY_RATE = 20

export function getKFactor(gamesPlayed: number): number {
  return K_MIN + (K_MAX - K_MIN) * Math.exp(-gamesPlayed / K_DECAY_RATE)
}

export function getExpectedScore(playerElo: number, opponentElo: number): number {
  return 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400))
}

/**
 * Calculates Elo changes for a single multiplayer game.
 * Uses pairwise comparison approach.
 */
export function calculateEloChanges(
  players: { id: string; elo: number; gamesPlayed: number; position: number }[]
): Record<string, number> {
  const eloChanges: Record<string, number> = {}

  // Initialize changes to 0
  players.forEach((p) => (eloChanges[p.id] = 0))

  // Compare every player with every other player
  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const p1 = players[i]
      const p2 = players[j]

      // Determine actual outcome for pairwise match
      // If p1.position < p2.position, p1 won (smaller rank is better)
      let s1 = 0.5
      let s2 = 0.5

      if (p1.position < p2.position) {
        s1 = 1
        s2 = 0
      } else if (p1.position > p2.position) {
        s1 = 0
        s2 = 1
      }
      // Tie (equal position) remains 0.5

      const expected1 = getExpectedScore(p1.elo, p2.elo)
      const expected2 = getExpectedScore(p2.elo, p1.elo)

      const k1 = getKFactor(p1.gamesPlayed)
      const k2 = getKFactor(p2.gamesPlayed)

      // Calculate change
      // Note: In multiplayer, we sum the pairwise changes. 
      // Some implementations divide by (N-1) to scale down, but 
      // summing is valid for pairwise-elo (rank-based). 
      // We will stick to simple pairwise summation as it rewards beating many players.
      
      const change1 = k1 * (s1 - expected1)
      const change2 = k2 * (s2 - expected2)

      eloChanges[p1.id] += change1
      eloChanges[p2.id] += change2
    }
  }

  // Round to nearest integer
  Object.keys(eloChanges).forEach((id) => {
    eloChanges[id] = Math.round(eloChanges[id])
  })

  return eloChanges
}
