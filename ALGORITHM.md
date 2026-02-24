# GLEU — Algorithm Deep Dive

> **GLEU** (Game League Elo Utility) is a multiplayer Elo-based ranking system designed for **UNO No Mercy**. This document provides an exhaustive, in-depth explanation of every algorithm, data structure, and pipeline used across the entire codebase.

---

## Table of Contents

1. [High-Level Architecture](#1-high-level-architecture)
2. [Data Model (Database Schema)](#2-data-model-database-schema)
3. [The Elo Rating System — Fundamentals](#3-the-elo-rating-system--fundamentals)
4. [Adapting Elo for Multiplayer — Pairwise Decomposition](#4-adapting-elo-for-multiplayer--pairwise-decomposition)
5. [K-Factor Tiers](#5-k-factor-tiers)
6. [Ranking Normalization (Handling Rejoins)](#6-ranking-normalization-handling-rejoins)
7. [End-to-End Game Submission Pipeline](#7-end-to-end-game-submission-pipeline)
8. [Real-Time Leaderboard Algorithm](#8-real-time-leaderboard-algorithm)
9. [Player Statistics Computation](#9-player-statistics-computation)
10. [Data Seeding & History Replay](#10-data-seeding--history-replay)
11. [Worked Example](#11-worked-example)
12. [Mathematical Summary](#12-mathematical-summary)

---

## 1. High-Level Architecture

```
┌───────────────────────────────────────────────────────┐
│                    FRONTEND (Next.js)                  │
│                                                       │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐  │
│  │ Leaderboard │  │  Add Game   │  │   History     │  │
│  │ (Real-time) │  │   Form      │  │   Page        │  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬───────┘  │
│         │                │                │           │
│         │   Supabase     │  Server Action │  Supabase │
│         │   Real-time    │                │  Query    │
└─────────┼────────────────┼────────────────┼───────────┘
          │                │                │
          ▼                ▼                ▼
┌───────────────────────────────────────────────────────┐
│                  ALGORITHM LAYER (lib/)                │
│                                                       │
│  ┌──────────────┐    ┌──────────────────────────────┐ │
│  │  ranking.ts  │───▶│           elo.ts              │ │
│  │ Normalize    │    │  Expected Score               │ │
│  │ Rankings     │    │  K-Factor Selection            │ │
│  │ (Rejoins)    │    │  Pairwise Elo Calculation      │ │
│  └──────────────┘    └──────────────────────────────┘ │
└───────────────────────────────────────────────────────┘
          │                │                │
          ▼                ▼                ▼
┌───────────────────────────────────────────────────────┐
│               SUPABASE (PostgreSQL)                   │
│                                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐    │
│  │ players  │  │  games   │  │  game_results    │    │
│  │          │◀─┤          │◀─┤                  │    │
│  │ id       │  │ id       │  │ game_id (FK)     │    │
│  │ name     │  │ played_at│  │ player_id (FK)   │    │
│  │ elo      │  │ total_   │  │ raw_positions[]  │    │
│  │ created  │  │ players  │  │ normalized_pos   │    │
│  └──────────┘  └──────────┘  │ elo_before/after │    │
│                              │ elo_change       │    │
│                              └──────────────────┘    │
└───────────────────────────────────────────────────────┘
```

The system operates in three layers:

1. **Frontend** — Collects game results (ordered list of who was eliminated in what position), displays a real-time leaderboard, and shows game history.
2. **Algorithm Layer** — Normalizes raw rankings (handling players who rejoin the game after being eliminated) and computes Elo changes using a pairwise decomposition of the multiplayer game.
3. **Database** — Stores players, games, and per-game results with full Elo audit trail (before, after, change).

---

## 2. Data Model (Database Schema)

### 2.1 `players` Table

| Column       | Type        | Description                                          |
| ------------ | ----------- | ---------------------------------------------------- |
| `id`         | `UUID`      | Primary key, auto-generated                          |
| `name`       | `TEXT`      | Unique player name                                   |
| `initial_elo`| `INTEGER`   | **Current Elo rating** (starts at 1000, updated after each game) |
| `created_at` | `TIMESTAMPTZ` | When the player was registered                     |

> **Design Note:** The column is named `initial_elo` but is treated as **current Elo** throughout the codebase — it gets updated after every game. This is a naming artifact; semantically it is the player's **live** Elo.

### 2.2 `games` Table

| Column         | Type        | Description                          |
| -------------- | ----------- | ------------------------------------ |
| `id`           | `UUID`      | Primary key                          |
| `played_at`    | `TIMESTAMPTZ` | When the game was played           |
| `total_players`| `INTEGER`   | Number of unique players in the game |
| `created_at`   | `TIMESTAMPTZ` | Record creation timestamp          |

### 2.3 `game_results` Table

| Column                | Type        | Description                                                      |
| --------------------- | ----------- | ---------------------------------------------------------------- |
| `id`                  | `UUID`      | Primary key                                                      |
| `game_id`             | `UUID` (FK) | References `games.id`                                            |
| `player_id`           | `UUID` (FK) | References `players.id`                                          |
| `raw_positions`       | `INTEGER[]` | Array of **all** positions this player held (e.g. `[3, 7]` if they were eliminated 3rd, rejoined, then eliminated 7th) |
| `normalized_position` | `NUMERIC`   | The averaged/normalized final position (e.g. `5.0` from `[3, 7]`) |
| `elo_before`          | `INTEGER`   | Player's Elo **before** this game                                |
| `elo_after`           | `INTEGER`   | Player's Elo **after** this game                                 |
| `elo_change`          | `INTEGER`   | Delta (positive or negative)                                     |
| `created_at`          | `TIMESTAMPTZ` | Record creation timestamp                                      |

This schema provides a **complete audit trail** — you can reconstruct every player's Elo history by walking through `game_results` chronologically.

---

## 3. The Elo Rating System — Fundamentals

The [Elo rating system](https://en.wikipedia.org/wiki/Elo_rating_system) was originally invented by Arpad Elo for chess. Its core idea:

> A player's rating is a **probabilistic estimator** of their skill. The difference between two players' ratings predicts the probability of each winning.

### 3.1 Expected Score

Given two players with ratings $R_A$ and $R_B$, the **expected score** for Player A is:

$$E_A = \frac{1}{1 + 10^{(R_B - R_A) / 400}}$$

This is a **logistic function** centered at rating difference 0 (meaning equal players have a 50% expected score). Key properties:

| Rating Difference ($R_A - R_B$) | $E_A$ (Expected Score for A) |
| ------------------------------- | ----------------------------- |
| +400                            | ~0.91 (91% chance A wins)     |
| +200                            | ~0.76                         |
| 0                               | 0.50 (coin flip)              |
| -200                            | ~0.24                         |
| -400                            | ~0.09                         |

The constant **400** is a scaling factor that controls how spread out the ratings are. This is a standard value used in chess and most Elo implementations.

**Implementation** (`lib/elo.ts`):

```typescript
export function getExpectedScore(playerElo: number, opponentElo: number): number {
  return 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400))
}
```

### 3.2 Rating Update Formula

After a game, the new rating is:

$$R'_A = R_A + K \cdot (S_A - E_A)$$

Where:
- $R_A$ = current rating
- $K$ = K-factor (sensitivity constant, see [Section 5](#5-k-factor-tiers))
- $S_A$ = **actual score** (1 for win, 0 for loss, 0.5 for draw)
- $E_A$ = **expected score** (from the logistic function above)
- $R'_A$ = new rating

**Interpretation:**
- If you **beat someone you were expected to beat**, you gain very little (S - E ≈ 0).
- If you **beat someone much stronger**, you gain a lot (S - E ≈ 1).
- If you **lose to someone weaker**, you lose a lot (S - E ≈ -1).

This is the fundamental elegance of Elo: **ratings automatically calibrate** based on the quality of your opponents.

---

## 4. Adapting Elo for Multiplayer — Pairwise Decomposition

Standard Elo is designed for **two-player** games. UNO No Mercy has **N players** (typically 4–9). GLEU uses the **pairwise decomposition** approach to extend Elo to multiplayer.

### 4.1 The Core Idea

A single N-player game is decomposed into $\binom{N}{2}$ (N-choose-2) **virtual head-to-head matches**. For example, a 4-player game becomes 6 pairwise matchups:

```
Players: A, B, C, D  (finishing positions: 1st, 2nd, 3rd, 4th)

Virtual matches:
  A vs B → A won (1st < 2nd)
  A vs C → A won (1st < 3rd)
  A vs D → A won (1st < 4th)
  B vs C → B won (2nd < 3rd)
  B vs D → B won (2nd < 4th)
  C vs D → C won (3rd < 4th)
```

### 4.2 Determining Actual Scores

For each pair $(i, j)$:

| Condition                              | $S_i$ | $S_j$ |
| -------------------------------------- | ----- | ----- |
| Player $i$ finished higher (lower position number) | 1.0   | 0.0   |
| Player $j$ finished higher             | 0.0   | 1.0   |
| Tied (same normalized position)        | 0.5   | 0.5   |

> A **lower position number** means a **better** finish. Position 1 = winner, Position N = last place.

### 4.3 Accumulating Changes

For each virtual match, the standard Elo update is computed. The key difference is that all pairwise changes are **summed** for each player:

$$\Delta R_i = \sum_{j \neq i} K_i \cdot (S_{ij} - E_{ij})$$

Where $S_{ij}$ is the actual score of player $i$ against player $j$, and $E_{ij}$ is the expected score.

**Implementation** (`lib/elo.ts`):

```typescript
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

      // Determine actual outcome
      let s1 = 0.5, s2 = 0.5
      if (p1.position < p2.position) { s1 = 1; s2 = 0 }
      else if (p1.position > p2.position) { s1 = 0; s2 = 1 }

      const expected1 = getExpectedScore(p1.elo, p2.elo)
      const expected2 = getExpectedScore(p2.elo, p1.elo)

      const k1 = getKFactor(p1.gamesPlayed)
      const k2 = getKFactor(p2.gamesPlayed)

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
```

### 4.4 Why Pairwise Summation (Not Averaging)?

Some multiplayer Elo implementations divide the total change by $(N-1)$ to normalize. GLEU **does not** do this — it uses raw summation. This is a deliberate design choice:

- **Summing** rewards/penalizes more in larger games. Winning a 7-player game is more impressive than a 4-player game, so the winner gets a larger rating boost.
- **Averaging** would make the Elo change independent of game size, which doesn't reflect the competitive reality.

### 4.5 Complexity

The pairwise comparison loop is $O(N^2)$ where $N$ is the number of players. For typical UNO games ($N \leq 10$), this is at most 45 comparisons — negligible.

---

## 5. K-Factor Tiers

The **K-factor** controls how much a single game can change a player's rating. GLEU uses a tiered K-factor system based on how many games a player has played:

| Games Played | K-Factor | Tier Name      | Rationale                                                  |
| ------------ | -------- | -------------- | ---------------------------------------------------------- |
| < 20         | **32**   | Provisional    | New players' ratings should converge quickly toward their true skill |
| 20–49        | **24**   | Intermediate   | Moderate updates as the system gains confidence             |
| ≥ 50         | **16**   | Established    | Small updates — the system is confident in the player's rating |

**Implementation** (`lib/elo.ts`):

```typescript
export const K_FACTORS = {
  PROVISIONAL: 32,   // < 20 games
  INTERMEDIATE: 24,  // 20-50 games
  ESTABLISHED: 16,   // > 50 games
}

export function getKFactor(gamesPlayed: number): number {
  if (gamesPlayed < 20) return K_FACTORS.PROVISIONAL
  if (gamesPlayed < 50) return K_FACTORS.INTERMEDIATE
  return K_FACTORS.ESTABLISHED
}
```

**Why this matters:** A new player with K=32 can swing ±32 points per pairwise matchup, while an established player only swings ±16. This prevents long-time players from being overly disrupted by a single bad game, while allowing newcomers to find their true rating quickly.

> **Current Limitation:** The `gamesPlayed` count is hardcoded to `100` in the server action (`actions.ts`) and `10` in the seed script, meaning **all players currently use the ESTABLISHED K-factor (16)**. This is a TODO item noted in the code.

---

## 6. Ranking Normalization (Handling Rejoins)

UNO No Mercy has a unique mechanic: **players can be eliminated and then rejoin the game**. A player might be knocked out 3rd, rejoin, and then get knocked out 7th. The ranking normalization algorithm handles this.

### 6.1 The Problem

The raw input for a game is an **ordered sequence of eliminations**, where the same player can appear multiple times:

```
Raw: ['Rohit', 'Kabeer', 'Amay', 'Saurav', 'Chetan', 'Akshay', 'Rohit', 'Akshay', 'Rohit']
Positions: Rohit→1, Kabeer→2, Amay→3, Saurav→4, Chetan→5, Akshay→6, Rohit→7, Akshay→8, Rohit→9
```

Rohit appears at positions 1, 7, and 9. What is his "real" position?

### 6.2 The Algorithm

The `normalizeRankings` function in `lib/ranking.ts` does the following:

**Step 1: Group positions by player**

```
Rohit:   [1, 7, 9]
Kabeer:  [2]
Amay:    [3]
Saurav:  [4]
Chetan:  [5]
Akshay:  [6, 8]
```

**Step 2: Average the positions for each player**

$$\text{normalizedPosition}(p) = \frac{\sum \text{positions}(p)}{|\text{positions}(p)|}$$

```
Rohit:   (1 + 7 + 9) / 3 = 5.67
Kabeer:  2 / 1           = 2.0
Amay:    3 / 1           = 3.0
Saurav:  4 / 1           = 4.0
Chetan:  5 / 1           = 5.0
Akshay:  (6 + 8) / 2     = 7.0
```

**Step 3: Sort by normalized position (ascending)**

```
1. Kabeer  — 2.0
2. Amay    — 3.0
3. Saurav  — 4.0
4. Chetan  — 5.0
5. Rohit   — 5.67  ← Rejoined twice, penalized by averaging
6. Akshay  — 7.0
```

**Implementation** (`lib/ranking.ts`):

```typescript
export function normalizeRankings(
  rawRankings: { playerId: string; position: number }[]
): { playerId: string; normalizedPosition: number; rawPositions: number[] }[] {
  const playerPositions: Record<string, number[]> = {}

  // Group positions by player
  rawRankings.forEach((r) => {
    if (!playerPositions[r.playerId]) {
      playerPositions[r.playerId] = []
    }
    playerPositions[r.playerId].push(r.position)
  })

  // Calculate average position
  const normalized = Object.keys(playerPositions).map((playerId) => {
    const positions = playerPositions[playerId]
    const sum = positions.reduce((a, b) => a + b, 0)
    const avg = sum / positions.length
    return {
      playerId,
      normalizedPosition: avg,
      rawPositions: positions.sort((a, b) => a - b),
    }
  })

  // Sort by normalized position (ascending)
  return normalized.sort((a, b) => a.normalizedPosition - b.normalizedPosition)
}
```

### 6.3 Why Averaging?

Averaging is a reasonable heuristic because:

- A player who was **eliminated early** (e.g., 1st out) but **rejoined and lasted longer** (e.g., 7th out) performed somewhere in between.
- A player who was eliminated multiple times is inherently **weaker** in that game than someone who was only eliminated once, and averaging pushes them toward a worse (higher number) position.
- It preserves the **ordinal structure** needed by the pairwise Elo algorithm — all players end up with a unique or near-unique normalized position.

### 6.4 Edge Case: Ties in Normalized Position

If two players have the **same** normalized position after averaging (unlikely but possible), the pairwise Elo comparison treats it as a **draw** ($S = 0.5$ for both), so neither gains nor loses relative to each other.

---

## 7. End-to-End Game Submission Pipeline

When a user submits a game result through the UI, the following pipeline executes in the `submitGame` server action (`app/actions.ts`):

```
User Input (Form)
       │
       ▼
┌──────────────────────┐
│ 1. NORMALIZE         │  Raw positions → Averaged positions
│    normalizeRankings()│  Handles rejoins
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ 2. FETCH PLAYERS     │  Get current Elo for each player
│    Supabase query    │  from the `players` table
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ 3. PREPARE ELO INPUT │  Combine normalized positions
│                      │  with current Elo ratings
│                      │  and games played count
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ 4. CALCULATE ELO     │  Pairwise decomposition
│    calculateEloChanges()│ O(N²) comparisons
│                      │  Compute Δ for each player
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ 5. PERSIST TO DB     │
│  a. INSERT game      │  Create game record
│  b. INSERT results   │  One row per player with full audit trail
│  c. UPDATE players   │  Set new Elo = old Elo + change
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ 6. REVALIDATE        │  Trigger Next.js ISR revalidation
│    revalidatePath()  │  for '/' and '/history'
└──────────────────────┘
```

### 7.1 Detailed Step Breakdown

#### Step 1: Normalize Rankings
```typescript
const normalized = normalizeRankings(formData)
```
The form data is an array of `{ playerId, position }` entries. The same `playerId` can appear multiple times if they rejoined. This step reduces it to one entry per player with an averaged position.

#### Step 2: Fetch Current Elo
```typescript
const { data: players } = await supabase
  .from('players')
  .select('id, initial_elo')
  .in('id', playerIds)
```
We need the **current live rating** to calculate expected scores.

#### Step 3: Prepare Elo Input
```typescript
const eloInput = normalized.map(n => ({
  id: player.id,
  elo: player.initial_elo,
  gamesPlayed: 100,           // TODO: fetch actual count
  position: n.normalizedPosition
}))
```

#### Step 4: Calculate Elo Changes
```typescript
const eloChanges = calculateEloChanges(eloInput)
// Returns: { "player-uuid-1": +15, "player-uuid-2": -8, ... }
```

#### Step 5: Persist
- **Create Game Record:** One row in `games` with `total_players` and `played_at`.
- **Create Result Records:** One row per player in `game_results` storing `elo_before`, `elo_after`, `elo_change`, `raw_positions[]`, and `normalized_position`.
- **Update Player Ratings:** Each player's `initial_elo` is updated to `elo_before + elo_change`.

#### Step 6: Revalidate
```typescript
revalidatePath('/')
revalidatePath('/history')
```
This tells Next.js to regenerate the cached pages so the leaderboard and history reflect the new game.

---

## 8. Real-Time Leaderboard Algorithm

The leaderboard (`components/Leaderboard.tsx`) provides **live updates** using Supabase Realtime:

### 8.1 Initial Load

1. Fetch all players from `players` table, sorted by `initial_elo` descending.
2. Map each player to include `gamesPlayed` and `recentChange` (currently stubbed to 0).
3. Re-sort client-side by Elo (descending) to determine rank.

### 8.2 Real-Time Updates

```typescript
const channel = supabase
  .channel('leaderboard_changes')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'game_results' }, () => {
    fetchLeaderboard()  // Re-fetch everything
  })
  .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, () => {
    fetchLeaderboard()  // Re-fetch everything
  })
  .subscribe()
```

The component subscribes to **PostgreSQL change notifications** on both the `game_results` and `players` tables. Any INSERT, UPDATE, or DELETE on either table triggers a full leaderboard re-fetch.

This is a **simple polling-via-notification** approach: rather than incrementally updating the client-side state, it re-fetches the entire dataset. This is fine for small player counts (< 100 players) and guarantees consistency.

### 8.3 Rank Display

Players are ranked 1 through N by descending Elo. Top 3 get visual distinction:

| Rank | Color               | Indicator |
| ---- | ------------------- | --------- |
| 1st  | 🟡 Gold (uno-yellow) | 👑 Crown  |
| 2nd  | 🟢 Green (uno-green) |           |
| 3rd  | 🔵 Blue (uno-blue)   |           |
| Last |                     | 🍆 Eggplant |

---

## 9. Player Statistics Computation

The player profile page (`app/player/[id]/page.tsx`) computes several statistics from the `game_results` table:

### 9.1 Games Played
```typescript
const gamesPlayed = results?.length || 0
```
Simply the number of `game_results` rows for this player.

### 9.2 Win Rate
```typescript
const won = results?.filter((r) => r.normalized_position === 1).length || 0
const winRate = gamesPlayed > 0 ? Math.round((won / gamesPlayed) * 100) : 0
```
A "win" is defined as `normalized_position === 1` (i.e., the player finished first).

### 9.3 Average Position
```typescript
const avgPos = gamesPlayed > 0
  ? (results?.reduce((sum, r) => sum + r.normalized_position, 0) / gamesPlayed).toFixed(1)
  : '-'
```
The mean of all `normalized_position` values across all games. A lower number is better.

---

## 10. Data Seeding & History Replay

The `scripts/seed_history.ts` script replays historical games to establish initial Elo ratings. It follows this algorithm:

### 10.1 Process

```
1. Extract all unique player names from game history data
2. For each player:
   a. If exists in DB → RESET Elo to 1000
   b. If doesn't exist → CREATE with Elo 1000
3. DELETE all existing game records (clean slate)
4. Sort all games by date (chronological order)
5. For each game (earliest first):
   a. Convert raw names → player IDs
   b. Normalize rankings (handle rejoins)
   c. Fetch current Elo for all involved players
   d. Calculate Elo changes via pairwise algorithm
   e. Insert game & results records
   f. Update each player's Elo in the DB
6. Done — all ratings reflect the full history
```

### 10.2 Why Order Matters

Games **must** be processed chronologically because each game depends on the **current** Elo of each player at the time of play. Processing Game 5 before Game 3 would use the wrong Elo values, producing incorrect results.

### 10.3 Raw Data Format

Games are encoded as ordered arrays of names, where the **position in the array is the elimination order**:

```typescript
{
  date: '2026-02-06T13:20:00Z',
  raw: ['Rohit', 'Kabeer', 'Amay', 'Saurav', 'Chetan', 'Akshay', 'Rohit', 'Akshay', 'Rohit']
}
```

This means:
- Position 1: Rohit (eliminated first)
- Position 2: Kabeer
- Position 3: Amay
- Position 4: Saurav
- Position 5: Chetan
- Position 6: Akshay
- Position 7: Rohit (rejoined, eliminated again)
- Position 8: Akshay (rejoined, eliminated again)
- Position 9: Rohit (rejoined again, eliminated third time)

---

## 11. Worked Example

Let's trace through a complete game with 4 players:

### Setup

| Player  | Current Elo |
| ------- | ----------- |
| Alice   | 1200        |
| Bob     | 1100        |
| Charlie | 1000        |
| Diana   | 900         |

**Game Result:** Alice 1st, Bob 2nd, Charlie 3rd, Diana 4th.

### Step 1: Pairwise Comparisons

**Alice vs Bob:**
- $E_{Alice} = \frac{1}{1 + 10^{(1100 - 1200)/400}} = \frac{1}{1 + 10^{-0.25}} \approx 0.640$
- $S_{Alice} = 1$ (Alice beat Bob)
- $\Delta_{Alice} = K \cdot (1 - 0.640) = 16 \times 0.360 = +5.76$
- $\Delta_{Bob} = 16 \times (0 - 0.360) = -5.76$

**Alice vs Charlie:**
- $E_{Alice} = \frac{1}{1 + 10^{(1000 - 1200)/400}} = \frac{1}{1 + 10^{-0.5}} \approx 0.760$
- $\Delta_{Alice} = 16 \times (1 - 0.760) = +3.84$
- $\Delta_{Charlie} = 16 \times (0 - 0.240) = -3.84$

**Alice vs Diana:**
- $E_{Alice} = \frac{1}{1 + 10^{(900 - 1200)/400}} = \frac{1}{1 + 10^{-0.75}} \approx 0.849$
- $\Delta_{Alice} = 16 \times (1 - 0.849) = +2.42$
- $\Delta_{Diana} = 16 \times (0 - 0.151) = -2.42$

**Bob vs Charlie:**
- $E_{Bob} = \frac{1}{1 + 10^{(1000 - 1100)/400}} \approx 0.640$
- $\Delta_{Bob} = 16 \times (1 - 0.640) = +5.76$
- $\Delta_{Charlie} = 16 \times (0 - 0.360) = -5.76$

**Bob vs Diana:**
- $E_{Bob} = \frac{1}{1 + 10^{(900 - 1100)/400}} \approx 0.760$
- $\Delta_{Bob} = 16 \times (1 - 0.760) = +3.84$
- $\Delta_{Diana} = 16 \times (0 - 0.240) = -3.84$

**Charlie vs Diana:**
- $E_{Charlie} = \frac{1}{1 + 10^{(900 - 1000)/400}} \approx 0.640$
- $\Delta_{Charlie} = 16 \times (1 - 0.640) = +5.76$
- $\Delta_{Diana} = 16 \times (0 - 0.360) = -5.76$

### Step 2: Sum All Pairwise Changes

| Player  | Pairwise Deltas                 | Total Δ | Rounded |
| ------- | ------------------------------- | ------- | ------- |
| Alice   | +5.76 + 3.84 + 2.42            | **+12.02** | **+12** |
| Bob     | -5.76 + 5.76 + 3.84            | **+3.84** | **+4** |
| Charlie | -3.84 - 5.76 + 5.76            | **-3.84** | **-4** |
| Diana   | -2.42 - 3.84 - 5.76            | **-12.02** | **-12** |

### Step 3: New Ratings

| Player  | Before | Change | After    |
| ------- | ------ | ------ | -------- |
| Alice   | 1200   | +12    | **1212** |
| Bob     | 1100   | +4     | **1104** |
| Charlie | 1000   | -4     | **996**  |
| Diana   | 900    | -12    | **888**  |

**Observation:** The total change sums to zero (+12 + 4 - 4 - 12 = 0). This is a property of the Elo system — **rating points are conserved** (approximately, before rounding).

### What if the underdog wins?

If Diana (900) had won 1st place instead of Alice (1200):

| Player  | Before | Approx Change | After    |
| ------- | ------ | ------------- | -------- |
| Diana   | 900    | **+36**       | **936**  |
| Alice   | 1200   | **-36**       | **1164** |

The underdog gains much more because the **expected score gap** was large. This is the self-correcting nature of Elo.

---

## 12. Mathematical Summary

### Core Formulas

| Formula | Equation | Purpose |
| ------- | -------- | ------- |
| **Expected Score** | $E_A = \frac{1}{1 + 10^{(R_B - R_A) / 400}}$ | Probability player A outperforms B |
| **Rating Update** | $\Delta R_A = K \cdot (S_A - E_A)$ | Single pairwise update |
| **Multiplayer Update** | $\Delta R_i = \sum_{j \neq i} K_i \cdot (S_{ij} - E_{ij})$ | Sum of all pairwise updates |
| **Normalized Position** | $\bar{p}_i = \frac{\sum p_k}{n}$ | Average of all elimination positions for a rejoining player |

### System Constants

| Constant | Value | Meaning |
| -------- | ----- | ------- |
| Starting Elo | 1000 | New player default rating |
| Scaling Factor | 400 | Logistic curve spread |
| K (Provisional) | 32 | < 20 games |
| K (Intermediate) | 24 | 20–49 games |
| K (Established) | 16 | ≥ 50 games |

### Properties

- **Zero-sum:** Total Elo gained ≈ Total Elo lost (exact before rounding).
- **Self-correcting:** Underrated players gain more, overrated players lose more.
- **Monotonic in outcome:** Better finish → more Elo gained.
- **K-factor decay:** Ratings stabilize as players accumulate more games.
- **Position-agnostic base:** Every player starts from equal footing (1000).

---

*This document describes the algorithms as of the current implementation. Items marked TODO in the source code (actual games-played count for K-factor, trend tracking) will alter some behaviors when implemented.*
