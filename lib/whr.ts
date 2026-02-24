/**
 * Whole History Rating (WHR) — GLEU Implementation
 * 
 * Batch algorithm: jointly optimizes all player ratings across
 * entire game history using Plackett-Luce + Wiener process.
 * 
 * Internal ratings are in natural-log space (r=0 is average).
 * Output is converted to Elo-like scale (centered at 1000).
 * 
 * Reference: Rémi Coulom, "Whole-History Rating: A Bayesian Rating
 * System for Players of Time-Varying Strength", 2008
 */

export interface WHRGame {
  gameId: string
  playedAt: Date
  players: { playerId: string; position: number }[]
}

export interface WHRResult {
  playerRatings: Record<string, number>
  gameSnapshots: Record<string, Record<string, number>>
  gameChanges: Record<string, Record<string, number>>
}

// W²: variance per day of the Wiener process (in natural-log units)
// Controls how much a player's rating can drift between games.
// Higher → more responsive; lower → more smooth/stable.
// 0.3 gives ~±95 Elo points per day of drift allowance.
// For a small dataset (~17 games), this lets game evidence dominate.
const W2_PER_DAY = 0.3
const ITERATIONS = 100

// Convert natural-log rating to Elo-scale for display
function logToElo(r: number): number {
  return Math.round(1000 + r * 400 / Math.log(10))
}

export function computeWHR(games: WHRGame[]): WHRResult {
  const sorted = [...games].sort((a, b) => a.playedAt.getTime() - b.playedAt.getTime())
  
  const allPids = new Set<string>()
  for (const g of sorted) for (const p of g.players) allPids.add(p.playerId)

  // Per-player timeline
  const pGames: Record<string, number[]> = {} // pid -> game indices
  for (const pid of allPids) pGames[pid] = []
  for (let gi = 0; gi < sorted.length; gi++) {
    for (const p of sorted[gi].players) pGames[p.playerId].push(gi)
  }

  // Time gaps (days) between consecutive games for each player
  const pDays: Record<string, number[]> = {}
  for (const pid of allPids) {
    const gis = pGames[pid]
    pDays[pid] = []
    for (let i = 1; i < gis.length; i++) {
      pDays[pid].push(Math.max(0.5,
        (sorted[gis[i]].playedAt.getTime() - sorted[gis[i-1]].playedAt.getTime()) / 86400000
      ))
    }
  }

  // Ratings in natural-log space (0 = average, positive = better)
  const r: Record<string, number[]> = {}
  for (const pid of allPids) {
    r[pid] = new Array(pGames[pid].length).fill(0)
  }

  // ============================================================
  // Newton-Raphson iterations
  // ============================================================
  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (const pid of allPids) {
      const gis = pGames[pid]
      if (gis.length === 0) continue

      for (let li = 0; li < gis.length; li++) {
        const gi = gis[li]
        const game = sorted[gi]
        const ri = r[pid][li]
        const gi_strength = Math.exp(ri)  // gamma_i = e^r_i

        // Get all participants' strengths
        const parts = game.players.map(p => {
          const pli = pGames[p.playerId].indexOf(gi)
          return {
            pid: p.playerId,
            pos: p.position,
            gamma: Math.exp(r[p.playerId][pli]),
          }
        })
        parts.sort((a, b) => a.pos - b.pos)

        // ----------------------------------------------------------
        // PL log-likelihood gradient & hessian w.r.t. r_i
        // 
        // d(log L)/d(r_i) for Plackett-Luce:
        //   For each round k (elimination from top):
        //     If player i was chosen: += 1 - gamma_i/S_k
        //     Else if player i is in pool: += -gamma_i/S_k
        //   where S_k = sum of gammas in remaining pool
        //
        // d²(log L)/d(r_i)² :
        //   For each round k where i is in pool:
        //     += -(gamma_i/S_k) * (1 - gamma_i/S_k)
        // ----------------------------------------------------------
        let grad = 0
        let hess = 0
        let poolSum = parts.reduce((s, p) => s + p.gamma, 0)

        for (let k = 0; k < parts.length - 1; k++) {
          const frac = gi_strength / poolSum

          if (parts[k].pid === pid) {
            grad += 1 - frac
          } else {
            grad -= frac
          }
          hess -= frac * (1 - frac)

          // Remove eliminated player from pool
          poolSum -= parts[k].gamma
          // If I was eliminated, I'm no longer in the pool
          if (parts[k].pid === pid) break
        }

        // ----------------------------------------------------------
        // Wiener process prior
        // P(r[t]|r[t-1]) ~ N(r[t-1], w²*dt)
        // ----------------------------------------------------------
        if (li > 0) {
          const v = W2_PER_DAY * pDays[pid][li - 1]
          grad -= (ri - r[pid][li - 1]) / v
          hess -= 1 / v
        }
        if (li < gis.length - 1) {
          const v = W2_PER_DAY * pDays[pid][li]
          grad -= (ri - r[pid][li + 1]) / v
          hess -= 1 / v
        }

        // Newton update
        if (hess < -1e-6) {
          r[pid][li] -= grad / hess
        }
      }
    }
  }

  // ============================================================
  // Extract results (convert to Elo scale)
  // ============================================================
  const playerRatings: Record<string, number> = {}
  for (const pid of allPids) {
    playerRatings[pid] = logToElo(r[pid][r[pid].length - 1])
  }

  const gameSnapshots: Record<string, Record<string, number>> = {}
  const gameChanges: Record<string, Record<string, number>> = {}

  for (let gi = 0; gi < sorted.length; gi++) {
    const game = sorted[gi]
    gameSnapshots[game.gameId] = {}
    gameChanges[game.gameId] = {}

    for (const p of game.players) {
      const li = pGames[p.playerId].indexOf(gi)
      const cur = logToElo(r[p.playerId][li])
      const prev = li > 0 ? logToElo(r[p.playerId][li - 1]) : 1000

      gameSnapshots[game.gameId][p.playerId] = cur
      gameChanges[game.gameId][p.playerId] = cur - prev
    }
  }

  return { playerRatings, gameSnapshots, gameChanges }
}
