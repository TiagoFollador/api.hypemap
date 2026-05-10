import { generateKeyPairSync } from 'crypto'

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})
process.env['JWT_PRIVATE_KEY'] = privateKey.replace(/\n/g, '\\n')
process.env['JWT_PUBLIC_KEY'] = publicKey.replace(/\n/g, '\\n')

import { buildApp } from '../../src/app'
import { prisma } from '../../src/db/prisma'
import { redisClient } from '../../src/db/redis'

let app: Awaited<ReturnType<typeof buildApp>>

beforeAll(async () => {
  app = await buildApp({ logger: false })
})

afterAll(async () => {
  await app.close()
  await prisma.$disconnect()
  await redisClient.quit()
})

describe('GET /health', () => {
  test('returns 200 with db:ok and redis:ok when services are up', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ db: string; redis: string; uptime: number }>()
    expect(body.db).toBe('ok')
    expect(body.redis).toBe('ok')
    expect(typeof body.uptime).toBe('number')
  })

  test('returns 503 when database is unreachable', async () => {
    const spy = jest
      .spyOn(prisma, '$queryRaw')
      .mockRejectedValueOnce(new Error('connection refused'))

    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(503)
    const body = res.json<{ db: string; redis: string }>()
    expect(body.db).toBe('error')
    expect(body.redis).toBe('ok')

    spy.mockRestore()
  })
})
