import jwt from 'jsonwebtoken'

interface AccessPayload {
  sub: string
  type: 'access'
}

interface RefreshPayload {
  sub: string
  type: 'refresh'
}

function getPrivateKey(): string {
  const key = process.env['JWT_PRIVATE_KEY']
  if (!key) throw new Error('JWT_PRIVATE_KEY not set')
  return key.replace(/\\n/g, '\n')
}

function getPublicKey(): string {
  const key = process.env['JWT_PUBLIC_KEY']
  if (!key) throw new Error('JWT_PUBLIC_KEY not set')
  return key.replace(/\\n/g, '\n')
}

export function signAccess(userId: string): string {
  return jwt.sign({ sub: userId, type: 'access' } satisfies AccessPayload, getPrivateKey(), {
    algorithm: 'RS256',
    expiresIn: '15m',
  })
}

export function signRefresh(userId: string): string {
  return jwt.sign({ sub: userId, type: 'refresh' } satisfies RefreshPayload, getPrivateKey(), {
    algorithm: 'RS256',
    expiresIn: '30d',
  })
}

export function verifyAccess(token: string): AccessPayload {
  const payload = jwt.verify(token, getPublicKey(), { algorithms: ['RS256'] })
  if (typeof payload === 'string' || payload['type'] !== 'access') {
    throw new jwt.JsonWebTokenError('invalid access token')
  }
  return payload as AccessPayload
}

export function verifyRefresh(token: string): RefreshPayload {
  const payload = jwt.verify(token, getPublicKey(), { algorithms: ['RS256'] })
  if (typeof payload === 'string' || payload['type'] !== 'refresh') {
    throw new jwt.JsonWebTokenError('invalid refresh token')
  }
  return payload as RefreshPayload
}
