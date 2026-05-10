import { generateKeyPairSync } from 'crypto'

// Inject RSA keys before any import of jwt.ts (keys are read lazily)
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

process.env['JWT_PRIVATE_KEY'] = privateKey.replace(/\n/g, '\\n')
process.env['JWT_PUBLIC_KEY'] = publicKey.replace(/\n/g, '\\n')

// Import after env is set
import { signAccess, signRefresh, verifyAccess, verifyRefresh } from '../../src/auth/jwt'

const TEST_USER_ID = 'user-123-test'

describe('JWT RS256 — access tokens', () => {
  it('signs and verifies an access token round-trip', () => {
    const token = signAccess(TEST_USER_ID)
    const payload = verifyAccess(token)
    expect(payload.sub).toBe(TEST_USER_ID)
    expect(payload.type).toBe('access')
  })

  it('rejects an access token used as refresh', () => {
    const token = signAccess(TEST_USER_ID)
    expect(() => verifyRefresh(token)).toThrow()
  })

  it('rejects a tampered access token', () => {
    const token = signAccess(TEST_USER_ID)
    const tampered = token.slice(0, -4) + 'XXXX'
    expect(() => verifyAccess(tampered)).toThrow()
  })
})

describe('JWT RS256 — refresh tokens', () => {
  it('signs and verifies a refresh token round-trip', () => {
    const token = signRefresh(TEST_USER_ID)
    const payload = verifyRefresh(token)
    expect(payload.sub).toBe(TEST_USER_ID)
    expect(payload.type).toBe('refresh')
  })

  it('rejects a refresh token used as access', () => {
    const token = signRefresh(TEST_USER_ID)
    expect(() => verifyAccess(token)).toThrow()
  })

  it('rejects a tampered refresh token', () => {
    const token = signRefresh(TEST_USER_ID)
    const tampered = token.slice(0, -4) + 'XXXX'
    expect(() => verifyRefresh(tampered)).toThrow()
  })
})
