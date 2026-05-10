import { generateKeyPairSync } from 'crypto'

// Must set JWT keys before any module that reads process.env is imported
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})
process.env['JWT_PRIVATE_KEY'] = privateKey.replace(/\n/g, '\\n')
process.env['JWT_PUBLIC_KEY'] = publicKey.replace(/\n/g, '\\n')

import pg from 'pg'
import { buildApp } from '../../src/app'
import { signAccess } from '../../src/auth/jwt'

const { Pool } = pg
const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })

const TEST_USER_ID = '11111111-1111-1111-1111-111111111111'
const TEST_HANDLE  = 'loc-test-user'
const TEST_EMAIL   = 'loc-test@hypemap.dev'

// Timestamps within the existing partition (2026-05)
const TS_1 = '2026-05-01T10:00:00.000Z'
const TS_2 = '2026-05-01T10:01:00.000Z'
const TS_3 = '2026-05-01T10:02:00.000Z'  // latest

let app: Awaited<ReturnType<typeof buildApp>>
let token: string

async function cleanupLocationData() {
  await pool.query('DELETE FROM location_event  WHERE user_id = $1', [TEST_USER_ID])
  await pool.query('DELETE FROM live_location   WHERE user_id = $1', [TEST_USER_ID])
}

beforeAll(async () => {
  app = await buildApp({ logger: false })
  await pool.query(
    `INSERT INTO app_user (id, handle, email, password_hash)
     VALUES ($1, $2, $3, 'x')
     ON CONFLICT (id) DO NOTHING`,
    [TEST_USER_ID, TEST_HANDLE, TEST_EMAIL],
  )
  token = signAccess(TEST_USER_ID)
  await cleanupLocationData()
})

afterAll(async () => {
  await cleanupLocationData()
  await pool.query('DELETE FROM app_user WHERE id = $1', [TEST_USER_ID])
  await app.close()
  await pool.end()
})

beforeEach(async () => {
  await cleanupLocationData()
})

describe('POST /v1/locations', () => {
  test('ingest 3 samples → 1 live_location row, 3 location_event rows', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/locations',
      headers: { authorization: `Bearer ${token}` },
      payload: [
        { lat: -22.9, lon: -43.3, accuracyM: 5,  isBackground: false, ts: TS_1 },
        { lat: -22.8, lon: -43.2, accuracyM: 8,  isBackground: false, ts: TS_2 },
        { lat: -22.7, lon: -43.1, accuracyM: 10, isBackground: true,  ts: TS_3 },
      ],
    })

    expect(res.statusCode).toBe(202)

    const { rows: liveRows } = await pool.query(
      'SELECT user_id FROM live_location WHERE user_id = $1',
      [TEST_USER_ID],
    )
    expect(liveRows).toHaveLength(1)

    const { rows: evtRows } = await pool.query(
      'SELECT COUNT(*) AS cnt FROM location_event WHERE user_id = $1',
      [TEST_USER_ID],
    )
    expect(Number(evtRows[0]?.cnt)).toBe(3)
  })

  test('live_location upserts to most-recent sample coordinates', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/locations',
      headers: { authorization: `Bearer ${token}` },
      payload: [
        { lat: -22.9, lon: -43.3, accuracyM: 5, isBackground: false, ts: TS_1 },
        { lat: -10.0, lon: -50.0, accuracyM: 3, isBackground: false, ts: TS_3 }, // latest
        { lat: -22.8, lon: -43.2, accuracyM: 8, isBackground: false, ts: TS_2 },
      ],
    })

    const { rows } = await pool.query<{ lat: string; lon: string }>(
      `SELECT ST_Y(geom) AS lat, ST_X(geom) AS lon FROM live_location WHERE user_id = $1`,
      [TEST_USER_ID],
    )
    expect(Number(rows[0]?.lat)).toBeCloseTo(-10.0, 4)
    expect(Number(rows[0]?.lon)).toBeCloseTo(-50.0, 4)
  })

  test('rejects lat out of range (91)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/locations',
      headers: { authorization: `Bearer ${token}` },
      payload: [{ lat: 91, lon: 0, accuracyM: 5, isBackground: false, ts: TS_1 }],
    })
    expect(res.statusCode).toBe(400)
  })

  test('rejects empty array', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/locations',
      headers: { authorization: `Bearer ${token}` },
      payload: [],
    })
    expect(res.statusCode).toBe(400)
  })

  test('rejects unauthenticated request', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/locations',
      payload: [{ lat: -22.9, lon: -43.3, accuracyM: 5, isBackground: false, ts: TS_1 }],
    })
    expect(res.statusCode).toBe(401)
  })
})
