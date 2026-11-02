-- Existing P2-1 databases already have dimension rows when score_state is added
-- by 0002. The current profile/preferences/rubric key is application config, so
-- SQL cannot prove those rows current; `stale` is the only honest backfill.
-- Rows touched by a post-0002 score run are no longer `pending` and are kept.
UPDATE `jobs`
SET `score_state` = 'stale'
WHERE `score_state` = 'pending'
  AND EXISTS (
    SELECT 1
    FROM `job_scores`
    WHERE `job_scores`.`job_id` = `jobs`.`id`
      AND `job_scores`.`content_hash` = `jobs`.`content_hash`
      AND `job_scores`.`dimensions` IS NOT NULL
  );