import Fastify, { type FastifyServerOptions } from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import authPlugin from './auth/authPlugin.js'
import { authRoutes } from './routes/v1/auth.js'
import { userRoutes } from './routes/v1/users.js'

export async function buildApp(opts: Partial<FastifyServerOptions> = {}) {
  const app = Fastify({
    logger: opts.logger ?? true,
    ...opts,
  })

  await app.register(cors, { origin: true })
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' })
  await app.register(authPlugin)

  await app.register(authRoutes, { prefix: '/v1' })
  await app.register(userRoutes, { prefix: '/v1' })

  return app
}
