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

const { Pool } = pg
const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })

const TEST_EMAIL = 'test-auth-flow@hypemap.dev'
const TEST_HANDLE = 'testflow'
const TEST_PASSWORD = 'supersecret99'

async function cleanupUser() {
  await pool.query('DELETE FROM app_user WHERE email = $1', [TEST_EMAIL])
}

let app: Awaited<ReturnType<typeof buildApp>>

beforeAll(async () => {
  app = await buildApp({ logger: false })
  await cleanupUser()
})

afterAll(async () => {
  await cleanupUser()
  await app.close()
  await pool.end()
})

describe('Auth flow — register → login → profile → delete', () => {
  let accessToken: string
  let refreshToken: string
  let userId: string

  it('POST /v1/auth/register returns 201 with tokens', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { handle: TEST_HANDLE, email: TEST_EMAIL, password: TEST_PASSWORD },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json<{ accessToken: string; refreshToken: string }>()
    expect(body.accessToken).toBeTruthy()
    expect(body.refreshToken).toBeTruthy()
    accessToken = body.accessToken
    refreshToken = body.refreshToken
  })

  it('POST /v1/auth/register with same email returns 409', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { handle: 'other_handle', email: TEST_EMAIL, password: TEST_PASSWORD },
    })
    expect(res.statusCode).toBe(409)
  })

  it('POST /v1/auth/login returns 200 with tokens', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: TEST_EMAIL, password: TEST_PASSWORD },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ accessToken: string; refreshToken: string }>()
    expect(body.accessToken).toBeTruthy()
    accessToken = body.accessToken
    refreshToken = body.refreshToken
  })

  it('POST /v1/auth/login with wrong password returns 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: TEST_EMAIL, password: 'wrongpassword' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('GET /v1/users/me with valid Bearer returns 200 with profile', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/users/me',
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ id: string; handle: string; email: string }>()
    expect(body.handle).toBe(TEST_HANDLE)
    expect(body.email).toBe(TEST_EMAIL)
    userId = body.id
  })

  it('GET /v1/users/me without Bearer returns 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/users/me' })
    expect(res.statusCode).toBe(401)
  })

  it('POST /v1/auth/refresh returns 200 with new tokens', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ accessToken: string; refreshToken: string }>()
    expect(body.accessToken).toBeTruthy()
    accessToken = body.accessToken
    refreshToken = body.refreshToken
  })

  it('POST /v1/auth/refresh with reused token returns 401 (rotation)', async () => {
    // First use: OK
    const res1 = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken },
    })
    expect(res1.statusCode).toBe(200)
    const newTokens = res1.json<{ refreshToken: string }>()

    // Second use of same token: must fail
    const res2 = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken },
    })
    expect(res2.statusCode).toBe(401)

    refreshToken = newTokens.refreshToken
    // Get fresh access token for delete test
    const loginRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: TEST_EMAIL, password: TEST_PASSWORD },
    })
    accessToken = loginRes.json<{ accessToken: string }>().accessToken
  })

  it('DELETE /v1/users/me returns 204 and user is gone from DB', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/users/me',
      headers: { authorization: `Bearer ${accessToken}` },
    })
    expect(res.statusCode).toBe(204)

    // Verify user is deleted from DB
    const { rows } = await pool.query('SELECT id FROM app_user WHERE id = $1', [userId])
    expect(rows).toHaveLength(0)
  })
})
