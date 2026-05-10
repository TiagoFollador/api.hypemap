import pg from 'pg'
import { env } from '../config/env.js'

const { Pool } = pg

export const pgPool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
})

pgPool.on('error', (err) => {
  console.error('pg pool error:', err)
})

export async function validatePostGIS(): Promise<string> {
  const { rows } = await pgPool.query<{ version: string }>(
    'SELECT PostGIS_Version() AS version',
  )
  const version = rows[0]?.version
  if (!version) throw new Error('PostGIS not available')
  return version
}
