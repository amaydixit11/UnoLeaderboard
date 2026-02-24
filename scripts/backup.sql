-- ============================================================
-- BACKUP: Run this BEFORE the recalculation script
-- Creates backup tables with all current data
-- ============================================================

-- Drop old backups if they exist
DROP TABLE IF EXISTS players_backup;
DROP TABLE IF EXISTS game_results_backup;

-- Create snapshots
CREATE TABLE players_backup AS SELECT * FROM players;
CREATE TABLE game_results_backup AS SELECT * FROM game_results;

-- Verify
SELECT 'players_backup' AS table_name, COUNT(*) AS rows FROM players_backup
UNION ALL
SELECT 'game_results_backup', COUNT(*) FROM game_results_backup;
