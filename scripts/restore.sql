-- ============================================================
-- RESTORE: Run this ONLY if you want to undo the recalculation
-- Restores data from backup tables
-- ============================================================

-- Restore players
UPDATE players p
SET initial_elo = b.initial_elo
FROM players_backup b
WHERE p.id = b.id;

-- Restore game_results
UPDATE game_results gr
SET elo_before = b.elo_before,
    elo_after = b.elo_after,
    elo_change = b.elo_change
FROM game_results_backup b
WHERE gr.id = b.id;

-- Verify restore
SELECT p.name, p.initial_elo AS current, b.initial_elo AS backup,
  CASE WHEN p.initial_elo = b.initial_elo THEN '✅' ELSE '❌' END AS match
FROM players p
JOIN players_backup b ON p.id = b.id
ORDER BY p.initial_elo DESC;
