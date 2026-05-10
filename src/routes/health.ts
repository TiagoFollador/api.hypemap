import type { FastifyInstance } from 'fastify'
import { prisma } from '../db/prisma.js'
import { redisClient } from '../db/redis.js'

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_req, reply) => {
    let db: 'ok' | 'error' = 'ok'
    let redis: 'ok' | 'error' = 'ok'

    try {
      await prisma.$queryRaw`SELECT 1`
    } catch {
      db = 'error'
    }

    try {
      const pong = await redisClient.ping()
      if (pong !== 'PONG') redis = 'error'
    } catch {
      redis = 'error'
    }

    const status = db === 'ok' && redis === 'ok' ? 200 : 503
    return reply.code(status).send({ db, redis, uptime: process.uptime() })
  })
}
