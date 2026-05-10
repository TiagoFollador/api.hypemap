import cron from 'node-cron'
import type { Server } from 'socket.io'
import { pgPool } from '../db/pg.js'

type HeatmapRow = { cell_geom: unknown; count: number }

export async function runHeatmapJob(io?: Server): Promise<HeatmapRow[]> {
  const { rows } = await pgPool.query<HeatmapRow>(`
    INSERT INTO heatmap_cell_5m (bucket_at, cell_geom, count)
    SELECT
      date_trunc('minute', now())          AS bucket_at,
      ST_SnapToGrid(geom::geometry, 0.001) AS cell_geom,
      count(*)::integer                    AS count
    FROM location_event
    WHERE happened_at >= now() - interval '2 minutes'
    GROUP BY 2
    ON CONFLICT (bucket_at, cell_geom)
      DO UPDATE SET count = EXCLUDED.count
    RETURNING cell_geom, count
  `)

  if (rows.length > 0) {
    io?.to('heatmap').volatile.emit('heatmap.patch', { ts: Date.now(), cells: rows })
  }

  return rows
}

export function startHeatmapJob(io: Server): void {
  cron.schedule('*/2 * * * *', () => {
    runHeatmapJob(io).catch((err) => console.error('heatmapJob error:', err))
  })
}
