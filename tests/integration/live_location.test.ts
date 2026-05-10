import pg from 'pg'

const { Pool } = pg

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })

// Test user id — deterministic so we can clean up reliably
const TEST_USER_ID = '00000000-0000-0000-0000-000000000001'
const LON = -43.3
const LAT = -22.9

beforeAll(async () => {
  // Seed a minimal app_user row that live_location FK references
  await pool.query(`
    INSERT INTO app_user (id, handle, email, password_hash)
    VALUES ($1, 'testuser', 'test@hypemap.dev', 'hash')
    ON CONFLICT (id) DO NOTHING
  `, [TEST_USER_ID])
})

beforeEach(async () => {
  await pool.query('DELETE FROM live_location WHERE user_id = $1', [TEST_USER_ID])
})

afterAll(async () => {
  await pool.query('DELETE FROM app_user WHERE id = $1', [TEST_USER_ID])
  await pool.end()
})

describe('live_location spatial round-trip', () => {
  it('inserts a Point and reads back correct lon/lat via ST_X / ST_Y', async () => {
    await pool.query(`
      INSERT INTO live_location (user_id, geom, geog, accuracy_m)
      VALUES (
        $1,
        ST_SetSRID(ST_MakePoint($2, $3), 4326),
        ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography,
        15.0
      )
    `, [TEST_USER_ID, LON, LAT])

    const { rows } = await pool.query<{ lon: number; lat: number; accuracy_m: number }>(`
      SELECT
        ST_X(geom)   AS lon,
        ST_Y(geom)   AS lat,
        accuracy_m
      FROM live_location
      WHERE user_id = $1
    `, [TEST_USER_ID])

    expect(rows).toHaveLength(1)
    expect(rows[0]!.lon).toBeCloseTo(LON, 5)
    expect(rows[0]!.lat).toBeCloseTo(LAT, 5)
    expect(rows[0]!.accuracy_m).toBeCloseTo(15.0, 1)
  })

  it('upserts on conflict: updates geom and accuracy_m', async () => {
    // First insert
    await pool.query(`
      INSERT INTO live_location (user_id, geom, geog, accuracy_m)
      VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, 10.0)
    `, [TEST_USER_ID, LON, LAT])

    // Upsert with new position
    const newLon = -43.4
    const newLat = -22.8
    await pool.query(`
      INSERT INTO live_location (user_id, geom, geog, accuracy_m, updated_at)
      VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326), ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, 5.0, now())
      ON CONFLICT (user_id) DO UPDATE
        SET geom = EXCLUDED.geom,
            geog = EXCLUDED.geog,
            accuracy_m = EXCLUDED.accuracy_m,
            updated_at = EXCLUDED.updated_at
    `, [TEST_USER_ID, newLon, newLat])

    const { rows } = await pool.query<{ lon: number; lat: number }>(`
      SELECT ST_X(geom) AS lon, ST_Y(geom) AS lat FROM live_location WHERE user_id = $1
    `, [TEST_USER_ID])

    expect(rows).toHaveLength(1)
    expect(rows[0]!.lon).toBeCloseTo(newLon, 5)
    expect(rows[0]!.lat).toBeCloseTo(newLat, 5)
  })

  it('confirms GiST indexes exist on geom and geog', async () => {
    const { rows } = await pool.query<{ indexname: string }>(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'live_location'
        AND indexdef ILIKE '%gist%'
      ORDER BY indexname
    `)

    const names = rows.map((r) => r.indexname)
    expect(names).toContain('live_location_geom_idx')
    expect(names).toContain('live_location_geog_idx')
  })

  it('confirms location_event_2026_05 partition exists', async () => {
    const { rows } = await pool.query<{ tablename: string }>(`
      SELECT tablename FROM pg_tables
      WHERE tablename = 'location_event_2026_05'
    `)
    expect(rows).toHaveLength(1)
  })
})
