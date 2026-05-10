import { buildApp } from './app.js'
import { env } from './config/env.js'
import { attachGateway } from './socket/gateway.js'
import { startLocationFanout } from './socket/fanout.js'

const app = await buildApp()

try {
  const address = await app.listen({ port: env.PORT, host: '0.0.0.0' })
  app.log.info(`HypeMap API listening at ${address}`)

  const io = attachGateway(app.server)
  await startLocationFanout(io)
  app.log.info('WebSocket presence gateway started')
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
