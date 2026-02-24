-- ============================================================
-- GLEU Elo Recalculation Script
-- Replays all games with dynamic K-factor: K(n) = 16 + 16*e^(-n/20)
-- 
-- Run this in the Supabase SQL Editor.
-- ============================================================

DO $$
DECLARE
  game_rec RECORD;
  result_rec RECORD;
  other_rec RECORD;
  
  -- Player state tracking
  player_elos JSONB := '{}'::JSONB;      -- { player_id: current_elo }
  player_games JSONB := '{}'::JSONB;     -- { player_id: games_played_count }
  
  -- Per-game calculation
  elo_changes JSONB;
  player_elo NUMERIC;
  other_elo NUMERIC;
  player_k NUMERIC;
  other_k NUMERIC;
  player_games_count INTEGER;
  other_games_count INTEGER;
  expected_score NUMERIC;
  actual_score NUMERIC;
  change_val NUMERIC;
  new_elo INTEGER;
  
  p_record RECORD;
BEGIN
  RAISE NOTICE '🔄 Starting Elo recalculation with dynamic K-factor...';
  RAISE NOTICE '';

  -- ============================================================
  -- STEP 1: Reset all players to Elo 1000 (in tracking JSONB)
  -- ============================================================
  FOR p_record IN SELECT id, name FROM players LOOP
    player_elos := player_elos || jsonb_build_object(p_record.id::TEXT, 1000);
    player_games := player_games || jsonb_build_object(p_record.id::TEXT, 0);
  END LOOP;

  RAISE NOTICE 'Initialized % players to Elo 1000', (SELECT COUNT(*) FROM players);

  -- ============================================================
  -- STEP 2: Process each game chronologically
  -- ============================================================
  FOR game_rec IN 
    SELECT id, played_at, total_players 
    FROM games 
    ORDER BY played_at ASC
  LOOP
    RAISE NOTICE '';
    RAISE NOTICE '📅 Processing game % (played: %)', game_rec.id, game_rec.played_at;

    -- Reset elo_changes for this game
    elo_changes := '{}'::JSONB;

    -- Initialize changes to 0 for all players in this game
    FOR result_rec IN 
      SELECT player_id, normalized_position 
      FROM game_results 
      WHERE game_id = game_rec.id
    LOOP
      elo_changes := elo_changes || jsonb_build_object(result_rec.player_id::TEXT, 0);
    END LOOP;

    -- ============================================================
    -- PAIRWISE COMPARISON: Compare every player with every other
    -- ============================================================
    FOR result_rec IN 
      SELECT player_id, normalized_position 
      FROM game_results 
      WHERE game_id = game_rec.id
      ORDER BY normalized_position ASC
    LOOP
      FOR other_rec IN 
        SELECT player_id, normalized_position 
        FROM game_results 
        WHERE game_id = game_rec.id 
          AND player_id > result_rec.player_id  -- Only compare each pair once
      LOOP
        -- Get current Elos
        player_elo := (player_elos ->> result_rec.player_id::TEXT)::NUMERIC;
        other_elo := (player_elos ->> other_rec.player_id::TEXT)::NUMERIC;

        -- Get games played counts
        player_games_count := (player_games ->> result_rec.player_id::TEXT)::INTEGER;
        other_games_count := (player_games ->> other_rec.player_id::TEXT)::INTEGER;

        -- Dynamic K-factor: K(n) = 16 + 16 * e^(-n/20)
        player_k := 16.0 + 16.0 * EXP(-player_games_count::NUMERIC / 20.0);
        other_k := 16.0 + 16.0 * EXP(-other_games_count::NUMERIC / 20.0);

        -- Expected scores (logistic function)
        -- E = 1 / (1 + 10^((opponent_elo - player_elo) / 400))
        expected_score := 1.0 / (1.0 + POWER(10.0, (other_elo - player_elo) / 400.0));

        -- Actual scores based on position (lower position = better)
        IF result_rec.normalized_position < other_rec.normalized_position THEN
          actual_score := 1.0;  -- result_rec won
        ELSIF result_rec.normalized_position > other_rec.normalized_position THEN
          actual_score := 0.0;  -- result_rec lost
        ELSE
          actual_score := 0.5;  -- tie
        END IF;

        -- Accumulate changes
        -- Player 1 change
        change_val := player_k * (actual_score - expected_score);
        elo_changes := jsonb_set(
          elo_changes,
          ARRAY[result_rec.player_id::TEXT],
          to_jsonb((elo_changes ->> result_rec.player_id::TEXT)::NUMERIC + change_val)
        );

        -- Player 2 change (mirror: score is 1-actual, expected is 1-expected)
        change_val := other_k * ((1.0 - actual_score) - (1.0 - expected_score));
        elo_changes := jsonb_set(
          elo_changes,
          ARRAY[other_rec.player_id::TEXT],
          to_jsonb((elo_changes ->> other_rec.player_id::TEXT)::NUMERIC + change_val)
        );
      END LOOP;
    END LOOP;

    -- ============================================================
    -- UPDATE game_results and player Elos for this game
    -- ============================================================
    FOR result_rec IN 
      SELECT gr.id, gr.player_id, gr.normalized_position, gr.elo_change AS old_change, p.name
      FROM game_results gr
      JOIN players p ON p.id = gr.player_id
      WHERE gr.game_id = game_rec.id
      ORDER BY gr.normalized_position ASC
    LOOP
      player_elo := (player_elos ->> result_rec.player_id::TEXT)::NUMERIC;
      change_val := ROUND((elo_changes ->> result_rec.player_id::TEXT)::NUMERIC);
      new_elo := (player_elo + change_val)::INTEGER;

      -- Update game_results row
      UPDATE game_results 
      SET elo_before = player_elo::INTEGER,
          elo_after = new_elo,
          elo_change = change_val::INTEGER
      WHERE id = result_rec.id;

      player_games_count := (player_games ->> result_rec.player_id::TEXT)::INTEGER;
      
      RAISE NOTICE '   % K=% Elo: % → % (old: %, new: %)',
        RPAD(result_rec.name, 12),
        LPAD(ROUND(16.0 + 16.0 * EXP(-player_games_count::NUMERIC / 20.0), 1)::TEXT, 5),
        player_elo::INTEGER,
        new_elo,
        result_rec.old_change,
        change_val::INTEGER;

      -- Update in-memory Elo
      player_elos := jsonb_set(player_elos, ARRAY[result_rec.player_id::TEXT], to_jsonb(new_elo));
    END LOOP;

    -- Increment games played for all participants
    FOR result_rec IN 
      SELECT DISTINCT player_id FROM game_results WHERE game_id = game_rec.id
    LOOP
      player_games_count := (player_games ->> result_rec.player_id::TEXT)::INTEGER;
      player_games := jsonb_set(
        player_games, 
        ARRAY[result_rec.player_id::TEXT], 
        to_jsonb(player_games_count + 1)
      );
    END LOOP;

  END LOOP;

  -- ============================================================
  -- STEP 3: Update all player final Elos
  -- ============================================================
  RAISE NOTICE '';
  RAISE NOTICE '📊 Final Elo ratings:';
  RAISE NOTICE '────────────────────────────────────────';
  
  FOR p_record IN 
    SELECT p.id, p.name, p.initial_elo AS old_elo, 
           (player_elos ->> p.id::TEXT)::INTEGER AS new_elo,
           (player_games ->> p.id::TEXT)::INTEGER AS games_count
    FROM players p
    ORDER BY (player_elos ->> p.id::TEXT)::INTEGER DESC
  LOOP
    RAISE NOTICE '  % % → % (%) [% games]',
      RPAD(p_record.name, 12),
      p_record.old_elo,
      p_record.new_elo,
      CASE WHEN p_record.new_elo - p_record.old_elo >= 0 
        THEN '+' || (p_record.new_elo - p_record.old_elo)
        ELSE (p_record.new_elo - p_record.old_elo)::TEXT
      END,
      p_record.games_count;

    UPDATE players SET initial_elo = p_record.new_elo WHERE id = p_record.id;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE '✅ Recalculation complete!';
END $$;
