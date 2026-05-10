import { buildApp } from './app.js'
import { env } from './config/env.js'
import { attachGateway, stopGateway } from './socket/gateway.js'
import { startLocationFanout, stopLocationFanout } from './socket/fanout.js'
import { startHeatmapJob } from './jobs/heatmapJob.js'
import { startPartitionJob } from './jobs/partitionJob.js'
import { prisma } from './db/prisma.js'
import { pgPool } from './db/pg.js'
import { redisClient } from './db/redis.js'

const app = await buildApp()

async function gracefulShutdown(): Promise<void> {
  app.log.info('SIGTERM received — shutting down gracefully')
  const hard = setTimeout(() => {
    app.log.error('graceful shutdown timed out — forcing exit')
    process.exit(1)
  }, 10_000)

  try {
    await app.close()
    await stopLocationFanout()
    await stopGateway()
    await prisma.$disconnect()
    await pgPool.end()
    await redisClient.quit()
    clearTimeout(hard)
    app.log.info('shutdown complete')
    process.exit(0)
  } catch (err) {
    clearTimeout(hard)
    app.log.error(err, 'error during shutdown')
    process.exit(1)
  }
}

process.on('SIGTERM', gracefulShutdown)
process.on('SIGINT', gracefulShutdown)

try {
  const address = await app.listen({ port: env.PORT, host: '0.0.0.0' })
  app.log.info(`HypeMap API listening at ${address}`)

  const io = attachGateway(app.server)
  await startLocationFanout(io)
  app.log.info('WebSocket presence gateway started')

  startHeatmapJob(io)
  app.log.info('heatmap job scheduled (every 2 minutes)')

  startPartitionJob()
  app.log.info('partition job scheduled (daily at 02:00 UTC)')
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
