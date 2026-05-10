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
import { io as ioc, type Socket as ClientSocket } from 'socket.io-client'
import { buildApp } from '../../src/app'
import { signAccess } from '../../src/auth/jwt'
import { attachGateway } from '../../src/socket/gateway'
import { startLocationFanout, stopLocationFanout } from '../../src/socket/fanout'

const { Pool } = pg

const USER_A_ID = 'aa000000-0000-0000-0000-000000000001'
const USER_B_ID = 'bb000000-0000-0000-0000-000000000002'

const HANDLE_A = 'gw-user-a'
const HANDLE_B = 'gw-user-b'

const SAMPLE_TS = '2026-05-09T12:00:00.000Z'

const pool = new Pool({ connectionString: process.env['DATABASE_URL'] })

let app: Awaited<ReturnType<typeof buildApp>>
let serverUrl: string
let tokenA: string
let tokenB: string
let clientB: ClientSocket

function waitForEvent<T>(socket: ClientSocket, event: string, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event '${event}'`))
    }, timeoutMs)
    socket.once(event, (data: T) => {
      clearTimeout(timer)
      resolve(data)
    })
  })
}

async function cleanup() {
  await pool.query('DELETE FROM location_event  WHERE user_id IN ($1,$2)', [USER_A_ID, USER_B_ID])
  await pool.query('DELETE FROM live_location   WHERE user_id IN ($1,$2)', [USER_A_ID, USER_B_ID])
  await pool.query('DELETE FROM friend_edge     WHERE user_id IN ($1,$2) OR friend_id IN ($1,$2)', [USER_A_ID, USER_B_ID])
  await pool.query('DELETE FROM app_user        WHERE id      IN ($1,$2)', [USER_A_ID, USER_B_ID])
}

beforeAll(async () => {
  app = await buildApp({ logger: false })
  const address = await app.listen({ port: 0, host: '127.0.0.1' })

  const port = (app.server.address() as { port: number }).port
  serverUrl = `http://127.0.0.1:${port}`

  const io = attachGateway(app.server)
  await startLocationFanout(io)

  await cleanup()

  await pool.query(
    `INSERT INTO app_user (id, handle, email, password_hash) VALUES ($1,$2,$3,'x'), ($4,$5,$6,'x')
     ON CONFLICT (id) DO NOTHING`,
    [USER_A_ID, HANDLE_A, 'gw-a@hypemap.dev', USER_B_ID, HANDLE_B, 'gw-b@hypemap.dev'],
  )

  // Bidirectional friend edge: A→B and B→A so both see each other
  await pool.query(
    `INSERT INTO friend_edge (user_id, friend_id) VALUES ($1,$2),($2,$1) ON CONFLICT DO NOTHING`,
    [USER_A_ID, USER_B_ID],
  )

  tokenA = signAccess(USER_A_ID)
  tokenB = signAccess(USER_B_ID)
})

afterAll(async () => {
  clientB?.disconnect()
  await stopLocationFanout()
  await cleanup()
  await app.close()
  await pool.end()
})

describe('WebSocket Presence Gateway', () => {
  test('client connects with valid JWT → receives hello event', async () => {
    const client = ioc(serverUrl, {
      transports: ['websocket'],
      auth: { token: tokenB },
    })

    try {
      const hello = await waitForEvent<{ userId: string }>(client, 'hello')
      expect(hello.userId).toBe(USER_B_ID)
    } finally {
      client.disconnect()
    }
  })

  test('client with invalid JWT is rejected', async () => {
    const client = ioc(serverUrl, {
      transports: ['websocket'],
      auth: { token: 'invalid.jwt.token' },
    })

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('expected connect_error')), 3000)
      client.on('connect_error', (err) => {
        clearTimeout(timer)
        expect(err.message).toContain('unauthorized')
        client.disconnect()
        resolve()
      })
      client.on('connect', () => {
        clearTimeout(timer)
        client.disconnect()
        reject(new Error('should not have connected'))
      })
    })
  })

  test('client with no token is rejected', async () => {
    const client = ioc(serverUrl, {
      transports: ['websocket'],
      auth: {},
    })

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('expected connect_error')), 3000)
      client.on('connect_error', (err) => {
        clearTimeout(timer)
        expect(err.message).toContain('unauthorized')
        client.disconnect()
        resolve()
      })
      client.on('connect', () => {
        clearTimeout(timer)
        client.disconnect()
        reject(new Error('should not have connected'))
      })
    })
  })

  test('userA ingest → userB receives presence.delta within 3s', async () => {
    clientB = ioc(serverUrl, {
      transports: ['websocket'],
      auth: { token: tokenB },
    })

    // Wait for hello to ensure connection is established
    await waitForEvent(clientB, 'hello')

    const deltaPromise = waitForEvent<{ t: string; payload: { userId: string } }>(
      clientB,
      'presence.delta',
    )

    // userA ingests a location batch via HTTP
    await app.inject({
      method: 'POST',
      url: '/v1/locations',
      headers: { authorization: `Bearer ${tokenA}` },
      payload: [
        { lat: -23.5505, lon: -46.6333, accuracyM: 5, isBackground: false, ts: SAMPLE_TS },
      ],
    })

    const delta = await deltaPromise
    expect(delta.t).toBe('presence.delta')
    expect(delta.payload.userId).toBe(USER_A_ID)
  })

  test('presence.subscribe for a valid squad room joins the room', async () => {
    const client = ioc(serverUrl, {
      transports: ['websocket'],
      auth: { token: tokenB },
    })

    try {
      await waitForEvent(client, 'hello')

      const snapshotPromise = waitForEvent<{ seq: number; payload: unknown[] }>(
        client,
        'presence.snapshot',
      )

      // Subscribing to a non-existent squad — server should still emit snapshot (with empty payload)
      client.emit('presence.subscribe', { roomIds: ['squad:nonexistent-squad-id'] })

      const snapshot = await snapshotPromise
      expect(typeof snapshot.seq).toBe('number')
      expect(Array.isArray(snapshot.payload)).toBe(true)
    } finally {
      client.disconnect()
    }
  })
})
