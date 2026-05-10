import type { FastifyPluginAsync } from 'fastify'
import { prisma } from '../../db/prisma.js'
import { pgPool } from '../../db/pg.js'
import { requireAuth } from '../../auth/authPlugin.js'

const BATCH_SIZE = 1000

async function batchDeleteLocationEvents(userId: string): Promise<void> {
  // Delete in batches to avoid long-running transactions on large event tables
  let deleted: number
  do {
    const result = await pgPool.query(
      `WITH batch AS (
         SELECT id FROM location_event WHERE user_id = $1 LIMIT $2
       )
       DELETE FROM location_event WHERE id IN (SELECT id FROM batch)`,
      [userId, BATCH_SIZE],
    )
    deleted = result.rowCount ?? 0
  } while (deleted === BATCH_SIZE)
}

export const userRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/users/me',
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = await prisma.user.findUniqueOrThrow({
        where: { id: request.userId },
        select: { id: true, handle: true, email: true, createdAt: true },
      })
      return reply.code(200).send(user)
    },
  )

  app.delete(
    '/users/me',
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.userId

      await batchDeleteLocationEvents(userId)
      await pgPool.query('DELETE FROM live_location WHERE user_id = $1', [userId])

      // Cascade deletes: friend_edge, consent_log, squad_member, refresh_token
      await prisma.user.delete({ where: { id: userId } })

      return reply.code(204).send()
    },
  )
}
