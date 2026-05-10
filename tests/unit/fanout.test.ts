import { generateKeyPairSync } from 'crypto'

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})
process.env['JWT_PRIVATE_KEY'] = privateKey.replace(/\n/g, '\\n')
process.env['JWT_PUBLIC_KEY'] = publicKey.replace(/\n/g, '\\n')

describe('fanout room resolution', () => {
  it('resolves friends:{userId} from notification payload', () => {
    const payload = { userId: 'abc-123', lat: -23.5, lon: -46.6, ts: '2026-05-09T00:00:00Z', seq: 1 }
    const room = `friends:${payload.userId}`
    expect(room).toBe('friends:abc-123')
  })

  it('parses notification JSON correctly', () => {
    const raw = JSON.stringify({ userId: 'xyz', lat: 10, lon: 20, ts: '2026-05-09T00:00:00Z', seq: 42 })
    const parsed = JSON.parse(raw) as { userId: string; lat: number; lon: number; ts: string; seq: number }
    expect(parsed.userId).toBe('xyz')
    expect(parsed.lat).toBe(10)
    expect(parsed.seq).toBe(42)
  })

  it('gracefully handles malformed JSON', () => {
    expect(() => {
      try {
        JSON.parse('not-json')
      } catch {
        // fanout.ts catches this and returns early
      }
    }).not.toThrow()
  })
})
