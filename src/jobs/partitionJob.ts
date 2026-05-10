import cron from 'node-cron'
import { pgPool } from '../db/pg.js'
import { env } from '../config/env.js'

export function partitionTableName(date: Date): string {
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `location_event_${y}_${m}`
}

export function nextMonthRange(now = new Date()): { name: string; from: string; to: string } {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  const after = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1))
  const name = partitionTableName(next)
  const from = next.toISOString().slice(0, 10)
  const to = after.toISOString().slice(0, 10)
  return { name, from, to }
}

async function createNextMonthPartition(): Promise<void> {
  const { name, from, to } = nextMonthRange()
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS ${name}
      PARTITION OF location_event
      FOR VALUES FROM ('${from}') TO ('${to}')
  `)
  console.info(`partitionJob: ensured partition ${name} (${from} → ${to})`)
}

async function dropOldPartitions(retentionDays: number): Promise<void> {
  const { rows } = await pgPool.query<{ table_name: string }>(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name ~ '^location_event_[0-9]{4}_[0-9]{2}$'
  `)

  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays)

  for (const { table_name } of rows) {
    const parts = table_name.split('_')
    const year = Number(parts[parts.length - 2])
    const month = Number(parts[parts.length - 1])
    if (isNaN(year) || isNaN(month)) continue

    // compare against the last day of that partition month
    const partitionEnd = new Date(Date.UTC(year, month, 1))
    if (partitionEnd <= cutoff) {
      await pgPool.query(`DROP TABLE IF EXISTS ${table_name}`)
      console.info(`partitionJob: dropped old partition ${table_name}`)
    }
  }
}

export async function runPartitionJob(): Promise<void> {
  await createNextMonthPartition()
  await dropOldPartitions(env.LOCATION_EVENT_RETENTION_DAYS)
}

export function startPartitionJob(): void {
  cron.schedule('0 2 * * *', () => {
    runPartitionJob().catch((err) => console.error('partitionJob error:', err))
  })
}
