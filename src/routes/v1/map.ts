import type { FastifyPluginAsync } from 'fastify'
import { pgPool } from '../../db/pg.js'
import { requireAuth } from '../../auth/authPlugin.js'

interface FriendPosition {
  id: string
  handle: string
  lat: number
  lon: number
  accuracyM: number | null
  updatedAt: string
}

interface FriendPositionRow {
  id: string
  handle: string
  lat: string
  lon: string
  accuracy_m: number | null
  updated_at: Date
}

const mapFriendsSchema = {
  querystring: {
    type: 'object',
    required: ['lat', 'lon', 'radiusM'],
    additionalProperties: false,
    properties: {
      lat:     { type: 'number', minimum: -90,  maximum: 90  },
      lon:     { type: 'number', minimum: -180, maximum: 180 },
      radiusM: { type: 'number', minimum: 1, maximum: 50000 },
    },
  },
} as const

export const mapRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/map/friends',
    {
      preHandler: requireAuth,
      schema: mapFriendsSchema,
    },
    async (request, reply) => {
      const { lat, lon, radiusM } = request.query as { lat: number; lon: number; radiusM: number }

      const result = await pgPool.query<FriendPositionRow>(
        `SELECT u.id,
                u.handle,
                ST_Y(ll.geom) AS lat,
                ST_X(ll.geom) AS lon,
                ll.accuracy_m,
                ll.updated_at
         FROM live_location ll
         JOIN friend_edge fe ON fe.friend_id = ll.user_id
         JOIN app_user    u  ON u.id         = ll.user_id
         WHERE fe.user_id = $1
           AND ST_DWithin(ll.geog, ST_SetSRID(ST_MakePoint($2,$3),4326)::geography, $4)
         LIMIT 200`,
        [request.userId, lon, lat, radiusM],
      )

      const positions: FriendPosition[] = result.rows.map((row) => ({
        id:        row.id,
        handle:    row.handle,
        lat:       Number(row.lat),
        lon:       Number(row.lon),
        accuracyM: row.accuracy_m,
        updatedAt: row.updated_at.toISOString(),
      }))

      return reply.code(200).send(positions)
    },
  )
}
