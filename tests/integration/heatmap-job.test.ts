import { generateKeyPairSync } from 'crypto'

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})
process.env['JWT_PRIVATE_KEY'] = privateKey.replace(/\n/g, '\\n')
process.env['JWT_PUBLIC_KEY'] = publicKey.replace(/\n/g, '\\n')

import pg from 'pg'
import { runHeatmapJob } from '../../src/jobs/heatmapJob'
import { pgPool } from '../../src/db/pg'

const { Pool } = pg
const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })

const TEST_USER_ID = 'hm000000-0000-0000-0000-000000000001'

async function cleanup() {
  await pool.query('DELETE FROM heatmap_cell_5m')
  await pool.query('DELETE FROM location_event WHERE user_id = $1', [TEST_USER_ID])
  await pool.query('DELETE FROM app_user WHERE id = $1', [TEST_USER_ID])
}

beforeAll(async () => {
  await cleanup()
  await pool.query(
    `INSERT INTO app_user (id, handle, email, password_hash)
     VALUES ($1, 'hm-test-user', 'hm-test@hypemap.dev', 'x')
     ON CONFLICT (id) DO NOTHING`,
    [TEST_USER_ID],
  )
  // Insert a location_event within the last 2-minute window using now()
  await pool.query(`
    INSERT INTO location_event (user_id, geom, geog, happened_at)
    VALUES (
      $1,
      ST_SetSRID(ST_MakePoint(-46.6333, -23.5505), 4326),
      ST_SetSRID(ST_MakePoint(-46.6333, -23.5505), 4326)::geography,
      now()
    )
  `, [TEST_USER_ID])
})

afterAll(async () => {
  await cleanup()
  await pool.end()
  await pgPool.end()
})

describe('runHeatmapJob', () => {
  test('populates heatmap_cell_5m after job runs', async () => {
    await runHeatmapJob()

    const { rows } = await pool.query<{ cnt: string }>(
      'SELECT COUNT(*) AS cnt FROM heatmap_cell_5m',
    )
    expect(Number(rows[0]?.cnt)).toBeGreaterThan(0)
  })
})
