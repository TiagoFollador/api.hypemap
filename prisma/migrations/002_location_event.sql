-- Append-only location history, partitioned by RANGE on happened_at.
-- BIGSERIAL id is local to each partition (not globally unique across partitions).
-- Use (user_id, happened_at) as the logical composite key for queries.
CREATE TABLE IF NOT EXISTS location_event (
  id            BIGSERIAL,
  user_id       UUID        NOT NULL,
  geom          geometry(Point, 4326) NOT NULL,
  geog          geography(Point, 4326) NOT NULL,
  accuracy_m    REAL,
  speed_mps     REAL,
  heading_deg   SMALLINT,
  is_background BOOLEAN     NOT NULL DEFAULT false,
  happened_at   TIMESTAMPTZ NOT NULL
) PARTITION BY RANGE (happened_at);

-- GiST on geog: spatial radius queries on historical events for heatmap aggregation
CREATE INDEX IF NOT EXISTS location_event_geog_idx ON location_event USING GIST (geog);
-- BRIN on happened_at: efficient range scans on the append-only time column
CREATE INDEX IF NOT EXISTS location_event_ts_idx ON location_event USING BRIN (happened_at);
-- B-tree on user_id + happened_at: per-user history queries
CREATE INDEX IF NOT EXISTS location_event_user_ts_idx ON location_event (user_id, happened_at DESC);

-- First partition: covers 2026-05
CREATE TABLE IF NOT EXISTS location_event_2026_05
  PARTITION OF location_event
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

-- Heatmap pre-aggregation table: rebuilt every 2 minutes by heatmapJob.
-- ST_SnapToGrid bucket size: 0.001 degrees (~111m).
CREATE TABLE IF NOT EXISTS heatmap_cell_5m (
  bucket_at   TIMESTAMPTZ NOT NULL,
  cell_geom   geometry(Point, 4326) NOT NULL,
  count       INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_at, cell_geom)
);

CREATE INDEX IF NOT EXISTS heatmap_cell_geom_idx ON heatmap_cell_5m USING GIST (cell_geom);
