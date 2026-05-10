import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import fp from 'fastify-plugin'
import { verifyAccess } from './jwt.js'

declare module 'fastify' {
  interface FastifyRequest {
    userId: string
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const authHeader = request.headers['authorization']
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'unauthorized' })
  }
  const token = authHeader.slice(7)
  try {
    const payload = verifyAccess(token)
    request.userId = payload.sub
  } catch {
    return reply.code(401).send({ error: 'unauthorized' })
  }
}

const authPlugin: FastifyPluginAsync = async (app) => {
  app.decorateRequest('userId', '')
}

export default fp(authPlugin, { name: 'auth' })
