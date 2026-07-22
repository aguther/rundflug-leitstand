ALTER TABLE resource_groups
  ADD COLUMN short_code TEXT NOT NULL DEFAULT '';

WITH ranked_groups AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY operation_day_id
           ORDER BY created_at, id
         ) AS group_number
    FROM resource_groups
)
UPDATE resource_groups
   SET short_code = (
     SELECT 'RG' || printf('%03d', group_number)
       FROM ranked_groups
      WHERE ranked_groups.id = resource_groups.id
   );

CREATE UNIQUE INDEX idx_resource_groups_operation_day_short_code
  ON resource_groups(operation_day_id, short_code);
