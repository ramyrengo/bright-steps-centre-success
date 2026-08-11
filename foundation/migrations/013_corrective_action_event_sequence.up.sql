ALTER TABLE corrective_action_events
ADD COLUMN event_sequence INTEGER;

WITH sequenced AS (
    SELECT
        id,
        row_number() OVER (
            PARTITION BY organisation_id, corrective_action_id
            ORDER BY occurred_at, created_at, id
        ) AS event_sequence
    FROM corrective_action_events
)
UPDATE corrective_action_events AS event
SET event_sequence = sequenced.event_sequence
FROM sequenced
WHERE sequenced.id = event.id;

ALTER TABLE corrective_action_events
ALTER COLUMN event_sequence SET NOT NULL;

ALTER TABLE corrective_action_events
ADD CONSTRAINT corrective_action_events_sequence_positive
CHECK (event_sequence > 0);

ALTER TABLE corrective_action_events
ADD CONSTRAINT corrective_action_events_sequence_unique
UNIQUE (organisation_id, corrective_action_id, event_sequence);
