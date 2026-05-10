import type { FastifyPluginAsync } from 'fastify'
import bcrypt from 'bcrypt'
import { createHash } from 'crypto'
import { prisma } from '../../db/prisma.js'
import { signAccess, signRefresh, verifyRefresh } from '../../auth/jwt.js'

const BCRYPT_ROUNDS = 12

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function refreshExpiresAt(): Date {
  const d = new Date()
  d.setDate(d.getDate() + 30)
  return d
}

async function issueTokenPair(userId: string): Promise<{ accessToken: string; refreshToken: string }> {
  const accessToken = signAccess(userId)
  const rawRefresh = signRefresh(userId)
  await prisma.refreshToken.create({
    data: {
      userId,
      tokenHash: sha256(rawRefresh),
      expiresAt: refreshExpiresAt(),
    },
  })
  return { accessToken, refreshToken: rawRefresh }
}

const registerSchema = {
  body: {
    type: 'object',
    required: ['handle', 'email', 'password'],
    additionalProperties: false,
    properties: {
      handle: { type: 'string', minLength: 3, maxLength: 32 },
      email: { type: 'string', format: 'email' },
      password: { type: 'string', minLength: 8 },
    },
  },
} as const

const loginSchema = {
  body: {
    type: 'object',
    required: ['email', 'password'],
    additionalProperties: false,
    properties: {
      email: { type: 'string', format: 'email' },
      password: { type: 'string', minLength: 1 },
    },
  },
} as const

const refreshSchema = {
  body: {
    type: 'object',
    required: ['refreshToken'],
    additionalProperties: false,
    properties: {
      refreshToken: { type: 'string', minLength: 1 },
    },
  },
} as const

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/auth/register', { schema: registerSchema }, async (request, reply) => {
    const { handle, email, password } = request.body as {
      handle: string
      email: string
      password: string
    }

    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { handle }] },
      select: { id: true },
    })
    if (existing) {
      return reply.code(409).send({ error: 'handle or email already taken' })
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
    const user = await prisma.user.create({
      data: { handle, email, passwordHash },
      select: { id: true },
    })

    const tokens = await issueTokenPair(user.id)
    return reply.code(201).send(tokens)
  })

  app.post(
    '/auth/login',
    {
      schema: loginSchema,
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const { email, password } = request.body as { email: string; password: string }

      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, passwordHash: true },
      })

      // Constant-time: always run bcrypt to avoid timing attacks
      const hash = user?.passwordHash ?? '$2b$12$invalidhashpadding000000000000000000000000000000000000000'
      const valid = await bcrypt.compare(password, hash)

      if (!user || !valid) {
        return reply.code(401).send({ error: 'invalid credentials' })
      }

      const tokens = await issueTokenPair(user.id)
      return reply.code(200).send(tokens)
    },
  )

  app.post('/auth/refresh', { schema: refreshSchema }, async (request, reply) => {
    const { refreshToken: rawToken } = request.body as { refreshToken: string }

    let userId: string
    try {
      const payload = verifyRefresh(rawToken)
      userId = payload.sub
    } catch {
      return reply.code(401).send({ error: 'invalid refresh token' })
    }

    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
    })

    if (!stored || stored.usedAt !== null || stored.expiresAt < new Date()) {
      return reply.code(401).send({ error: 'invalid refresh token' })
    }

    // Rotate: mark old token as used, issue new pair
    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { usedAt: new Date() },
    })

    const tokens = await issueTokenPair(userId)
    return reply.code(200).send(tokens)
  })
}
