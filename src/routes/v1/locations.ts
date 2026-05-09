import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { pgPool } from '../../db/pg.js'
import { requireAuth } from '../../auth/authPlugin.js'

interface LocationSample {
  lat: number
  lon: number
  accuracyM: number
  speedMps?: number
  headingDeg?: number
  isBackground: boolean
  ts: string
}

const locationsBodySchema = {
  body: {
    type: 'array',
    minItems: 1,
    maxItems: 100,
    items: {
      type: 'object',
      required: ['lat', 'lon', 'accuracyM', 'isBackground', 'ts'],
      additionalProperties: false,
      properties: {
        lat:          { type: 'number', minimum: -90,  maximum: 90  },
        lon:          { type: 'number', minimum: -180, maximum: 180 },
        accuracyM:    { type: 'number', minimum: 0 },
        speedMps:     { type: 'number', minimum: 0 },
        headingDeg:   { type: 'number', minimum: 0, maximum: 360 },
        isBackground: { type: 'boolean' },
        ts:           { type: 'string', format: 'date-time' },
      },
    },
  },
} as const

export const locationRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/locations',
    {
      preHandler: requireAuth,
      schema: locationsBodySchema,
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
          hook: 'preHandler',
          keyGenerator: (req) => (req as FastifyRequest).userId,
        },
      },
    },
    async (request, reply) => {
      const userId = request.userId
      const samples = request.body as LocationSample[]

      const latest = samples.reduce((a, b) => (a.ts > b.ts ? a : b))

      const client = await pgPool.connect()
      try {
        await client.query(
          `INSERT INTO live_location (user_id, geom, geog, accuracy_m, updated_at)
           VALUES ($1, ST_SetSRID(ST_MakePoint($2,$3),4326), ST_SetSRID(ST_MakePoint($2,$3),4326)::geography, $4, NOW())
           ON CONFLICT (user_id) DO UPDATE
             SET geom       = EXCLUDED.geom,
                 geog       = EXCLUDED.geog,
                 accuracy_m = EXCLUDED.accuracy_m,
                 updated_at = EXCLUDED.updated_at`,
          [userId, latest.lon, latest.lat, latest.accuracyM],
        )

        for (const s of samples) {
          await client.query(
            `INSERT INTO location_event (user_id, geom, geog, accuracy_m, speed_mps, heading_deg, is_background, happened_at)
             VALUES ($1, ST_SetSRID(ST_MakePoint($2,$3),4326), ST_SetSRID(ST_MakePoint($2,$3),4326)::geography, $4, $5, $6, $7, $8::timestamptz)`,
            [
              userId,
              s.lon,
              s.lat,
              s.accuracyM,
              s.speedMps ?? null,
              s.headingDeg ?? null,
              s.isBackground,
              s.ts,
            ],
          )
        }

        const seqResult = await client.query<{ seq: string }>(
          'SELECT COUNT(*)::bigint AS seq FROM location_event WHERE user_id = $1',
          [userId],
        )
        const seq = Number(seqResult.rows[0]?.seq ?? 0)

        await client.query('SELECT pg_notify($1, $2)', [
          'location_updates',
          JSON.stringify({ userId, lat: latest.lat, lon: latest.lon, ts: latest.ts, seq }),
        ])
      } finally {
        client.release()
      }

      return reply.code(202).send()
    },
  )
}
