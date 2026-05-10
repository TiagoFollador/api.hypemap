import type { FastifyPluginAsync } from 'fastify'
import { randomBytes } from 'crypto'
import { prisma } from '../../db/prisma.js'
import { requireAuth } from '../../auth/authPlugin.js'

const createSquadSchema = {
  body: {
    type: 'object',
    required: ['name'],
    additionalProperties: false,
    properties: {
      name:     { type: 'string', minLength: 1, maxLength: 80 },
      campusId: { type: 'string', maxLength: 64 },
    },
  },
} as const

const joinSquadSchema = {
  body: {
    type: 'object',
    required: ['inviteCode'],
    additionalProperties: false,
    properties: {
      inviteCode: { type: 'string', minLength: 1 },
    },
  },
} as const

export const squadRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/squads',
    { preHandler: requireAuth, schema: createSquadSchema },
    async (request, reply) => {
      const body = request.body as { name: string; campusId?: string }
      const inviteCode = randomBytes(6).toString('hex')

      const squad = await prisma.$transaction(async (tx) => {
        const s = await tx.squad.create({
          data: { name: body.name, campusId: body.campusId ?? null, inviteCode },
          select: { id: true, inviteCode: true },
        })
        await tx.squadMember.create({ data: { squadId: s.id, userId: request.userId } })
        return s
      })

      return reply.code(201).send({ id: squad.id, inviteCode: squad.inviteCode })
    },
  )

  app.get(
    '/squads/:id',
    { preHandler: requireAuth },
    async (request, reply) => {
      const { id } = request.params as { id: string }

      const squad = await prisma.squad.findUnique({
        where: { id },
        include: {
          members: {
            include: { user: { select: { id: true, handle: true } } },
            orderBy: { joinedAt: 'asc' },
          },
        },
      })

      if (!squad) {
        return reply.code(404).send({ error: 'squad not found' })
      }

      return reply.code(200).send({
        id:         squad.id,
        name:       squad.name,
        campusId:   squad.campusId,
        inviteCode: squad.inviteCode,
        members:    squad.members.map((m) => ({
          id:       m.user.id,
          handle:   m.user.handle,
          joinedAt: m.joinedAt.toISOString(),
        })),
        progress: squad.members.length,
      })
    },
  )

  app.post(
    '/squads/:id/join',
    { preHandler: requireAuth, schema: joinSquadSchema },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const body = request.body as { inviteCode: string }

      const squad = await prisma.squad.findUnique({
        where: { id },
        select: { id: true, inviteCode: true },
      })

      if (!squad) {
        return reply.code(404).send({ error: 'squad not found' })
      }

      if (squad.inviteCode !== body.inviteCode) {
        return reply.code(403).send({ error: 'invalid invite code' })
      }

      await prisma.squadMember.upsert({
        where: { squadId_userId: { squadId: id, userId: request.userId } },
        create: { squadId: id, userId: request.userId },
        update: {},
      })

      return reply.code(200).send({})
    },
  )
}
