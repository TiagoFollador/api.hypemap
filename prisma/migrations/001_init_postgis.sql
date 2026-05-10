-- Enable PostGIS (idempotent — safe to re-run)
CREATE EXTENSION IF NOT EXISTS postgis;

-- Add spatial columns to live_location (base table created by Prisma via db push).
-- geom: for tile/bbox queries (ST_X, ST_Y)
-- geog: for ST_DWithin meter-accurate radius queries
ALTER TABLE live_location
  ADD COLUMN IF NOT EXISTS geom geometry(Point, 4326),
  ADD COLUMN IF NOT EXISTS geog geography(Point, 4326);

-- GiST index on geom: bounding-box queries
CREATE INDEX IF NOT EXISTS live_location_geom_idx ON live_location USING GIST (geom);
-- GiST index on geog: ST_DWithin radius queries (meter-accurate on sphere)
CREATE INDEX IF NOT EXISTS live_location_geog_idx ON live_location USING GIST (geog);
-- B-tree on updated_at: TTL cleanup queries
CREATE INDEX IF NOT EXISTS live_location_updated_idx ON live_location (updated_at);
