import type { Server, Socket } from 'socket.io'
import { pgPool } from '../db/pg.js'
import { prisma } from '../db/prisma.js'
import { verifyAccess } from '../auth/jwt.js'

export function registerPresenceHandlers(io: Server, socket: Socket): void {
  const userId = socket.data.userId

  void socket.join(`user:${userId}`)
  void socket.join(`friends:${userId}`)

  socket.emit('hello', { userId, seq: 0, ts: Date.now() })

  socket.on('presence.subscribe', async (msg: { roomIds?: unknown }) => {
    const rawIds = Array.isArray(msg?.roomIds) ? (msg.roomIds as unknown[]) : []
    const roomIds = rawIds
      .filter((r): r is string => typeof r === 'string')
      .slice(0, 100)

    for (const roomId of roomIds) {
      if (!roomId.startsWith('squad:')) continue
      const squadId = roomId.slice(6)

      try {
        const member = await prisma.squadMember.findUnique({
          where: { squadId_userId: { squadId, userId } },
        })
        if (!member) continue
      } catch {
        continue
      }

      await socket.join(roomId)
    }

    const snapshot = await loadFriendSnapshot(userId)
    socket.emit('presence.snapshot', { seq: Date.now(), ts: Date.now(), payload: snapshot })
  })

  socket.on('auth.refresh', async (data: { token?: unknown }, ack?: (r: object) => void) => {
    const token = typeof data?.token === 'string' ? data.token : ''
    try {
      const payload = verifyAccess(token)
      socket.data.userId = payload.sub
      ack?.({ ok: true })
    } catch {
      ack?.({ ok: false, code: 'invalid_token' })
      socket.disconnect(true)
    }
  })
}

async function loadFriendSnapshot(userId: string) {
  const { rows } = await pgPool.query<{
    friend_id: string
    lat: string
    lon: string
    accuracy_m: string
    updated_at: Date
  }>(
    `SELECT fe.friend_id,
            ST_Y(ll.geom)  AS lat,
            ST_X(ll.geom)  AS lon,
            ll.accuracy_m,
            ll.updated_at
     FROM   friend_edge   fe
     JOIN   live_location ll ON ll.user_id = fe.friend_id
     WHERE  fe.user_id = $1`,
    [userId],
  )
  return rows
}
