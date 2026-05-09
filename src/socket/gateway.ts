import type { IncomingMessage, ServerResponse, Server as HttpServer } from 'node:http'
import { Server } from 'socket.io'
import { createAdapter } from '@socket.io/redis-adapter'
import { Redis } from 'ioredis'
import { env } from '../config/env.js'
import { verifyAccess } from '../auth/jwt.js'
import { registerPresenceHandlers } from './presenceHandler.js'

declare module 'socket.io' {
  interface SocketData {
    userId: string
    exp: number
  }
}

export function attachGateway(
  httpServer: HttpServer<typeof IncomingMessage, typeof ServerResponse>,
): Server {
  const io = new Server(httpServer, {
    transports: ['websocket'],
    cors: { origin: true },
  })

  const pub = new Redis(env.REDIS_URL)
  const sub = new Redis(env.REDIS_URL)
  pub.on('error', (err) => console.error('redis pub error:', err))
  sub.on('error', (err) => console.error('redis sub error:', err))
  io.adapter(createAdapter(pub, sub))

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined
    if (!token) return next(new Error('unauthorized'))
    try {
      const payload = verifyAccess(token)
      socket.data.userId = payload.sub
      next()
    } catch {
      next(new Error('unauthorized'))
    }
  })

  io.on('connection', (socket) => {
    registerPresenceHandlers(io, socket)
  })

  return io
}
