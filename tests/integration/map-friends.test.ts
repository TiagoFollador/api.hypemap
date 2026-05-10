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

const USER_A_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const USER_B_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const USER_C_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'  // no friend edge

// Coordinates: São Paulo area
const COORD_CLOSE = { lat: -23.5505, lon: -46.6333 }  // same city, within 1km
const COORD_FAR   = { lat: -30.0346, lon: -51.2177 }  // Porto Alegre, ~1000km away

let app: Awaited<ReturnType<typeof buildApp>>
let tokenA: string

async function seedLocation(userId: string, lat: number, lon: number) {
  await pool.query(
    `INSERT INTO live_location (user_id, geom, geog, accuracy_m, updated_at)
     VALUES ($1, ST_SetSRID(ST_MakePoint($2,$3),4326), ST_SetSRID(ST_MakePoint($2,$3),4326)::geography, 5, NOW())
     ON CONFLICT (user_id) DO UPDATE
       SET geom = EXCLUDED.geom, geog = EXCLUDED.geog, updated_at = EXCLUDED.updated_at`,
    [userId, lon, lat],
  )
}

beforeAll(async () => {
  app = await buildApp({ logger: false })

  // Seed users
  for (const [id, handle, email] of [
    [USER_A_ID, 'map-user-a', 'map-a@hypemap.dev'],
    [USER_B_ID, 'map-user-b', 'map-b@hypemap.dev'],
    [USER_C_ID, 'map-user-c', 'map-c@hypemap.dev'],
  ] as [string, string, string][]) {
    await pool.query(
      `INSERT INTO app_user (id, handle, email, password_hash) VALUES ($1,$2,$3,'x') ON CONFLICT (id) DO NOTHING`,
      [id, handle, email],
    )
  }

  // Seed live_location: B and C close to A's query point; no location for A
  await seedLocation(USER_B_ID, COORD_CLOSE.lat, COORD_CLOSE.lon)
  await seedLocation(USER_C_ID, COORD_CLOSE.lat, COORD_CLOSE.lon)

  // Friend edge: A ↔ B only
  await pool.query(
    `INSERT INTO friend_edge (user_id, friend_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [USER_A_ID, USER_B_ID],
  )

  tokenA = signAccess(USER_A_ID)
})

afterAll(async () => {
  await pool.query('DELETE FROM friend_edge   WHERE user_id IN ($1,$2,$3)',     [USER_A_ID, USER_B_ID, USER_C_ID])
  await pool.query('DELETE FROM live_location  WHERE user_id IN ($1,$2,$3)',    [USER_A_ID, USER_B_ID, USER_C_ID])
  await pool.query('DELETE FROM app_user       WHERE id      IN ($1,$2,$3)',    [USER_A_ID, USER_B_ID, USER_C_ID])
  await app.close()
  await pool.end()
})

describe('GET /v1/map/friends', () => {
  test('returns USER_B within 1000m radius', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/map/friends?lat=${COORD_CLOSE.lat}&lon=${COORD_CLOSE.lon}&radiusM=1000`,
      headers: { authorization: `Bearer ${tokenA}` },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { id: string }[]
    const ids = body.map((p) => p.id)
    expect(ids).toContain(USER_B_ID)
  })

  test('does not return USER_B when querying from far away', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/map/friends?lat=${COORD_FAR.lat}&lon=${COORD_FAR.lon}&radiusM=1000`,
      headers: { authorization: `Bearer ${tokenA}` },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { id: string }[]
    const ids = body.map((p) => p.id)
    expect(ids).not.toContain(USER_B_ID)
  })

  test('does not return USER_C (no friend edge) even when nearby', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/map/friends?lat=${COORD_CLOSE.lat}&lon=${COORD_CLOSE.lon}&radiusM=1000`,
      headers: { authorization: `Bearer ${tokenA}` },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body) as { id: string }[]
    const ids = body.map((p) => p.id)
    expect(ids).not.toContain(USER_C_ID)
  })

  test('rejects missing query params', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/map/friends?lat=-23.5&lon=-46.6',
      headers: { authorization: `Bearer ${tokenA}` },
    })
    expect(res.statusCode).toBe(400)
  })

  test('rejects unauthenticated request', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/map/friends?lat=${COORD_CLOSE.lat}&lon=${COORD_CLOSE.lon}&radiusM=1000`,
    })
    expect(res.statusCode).toBe(401)
  })
})
