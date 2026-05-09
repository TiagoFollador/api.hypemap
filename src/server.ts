import { buildApp } from './app.js'
import { env } from './config/env.js'

const app = await buildApp()

try {
  const address = await app.listen({ port: env.PORT, host: '0.0.0.0' })
  app.log.info(`HypeMap API listening at ${address}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
