import pg from 'pg'
import type { Server } from 'socket.io'
import { env } from '../config/env.js'

const { Client } = pg

let ioRef: Server | null = null
let listenClient: InstanceType<typeof Client> | null = null

export async function startLocationFanout(io: Server): Promise<void> {
  ioRef = io

  const client = new Client({ connectionString: env.DATABASE_URL })
  await client.connect()
  listenClient = client

  await client.query('LISTEN location_updates')

  client.on('notification', (msg) => {
    if (msg.channel !== 'location_updates' || !msg.payload) return

    let data: { userId: string; lat: number; lon: number; ts: string; seq: number }
    try {
      data = JSON.parse(msg.payload) as typeof data
    } catch {
      return
    }

    const room = `friends:${data.userId}`
    fanoutPresenceDelta(room, {
      t: 'presence.delta',
      ts: Date.now(),
      payload: { userId: data.userId, lat: data.lat, lon: data.lon, ts: data.ts, seq: data.seq },
    })
  })

  client.on('error', (err) => {
    console.error('fanout pg client error:', err)
  })
}

export function fanoutPresenceDelta(room: string, payload: unknown): void {
  ioRef?.to(room).volatile.emit('presence.delta', payload)
}

export async function stopLocationFanout(): Promise<void> {
  if (listenClient) {
    await listenClient.end()
    listenClient = null
  }
  ioRef = null
}
