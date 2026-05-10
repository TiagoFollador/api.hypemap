import { nextMonthRange, partitionTableName } from '../../src/jobs/partitionJob'

describe('partitionTableName', () => {
  test('formats name correctly for single-digit month', () => {
    expect(partitionTableName(new Date(Date.UTC(2026, 0, 1)))).toBe('location_event_2026_01')
  })

  test('formats name correctly for double-digit month', () => {
    expect(partitionTableName(new Date(Date.UTC(2026, 11, 1)))).toBe('location_event_2026_12')
  })
})

describe('nextMonthRange', () => {
  test('mid-year: returns correct next-month partition', () => {
    const now = new Date(Date.UTC(2026, 4, 10)) // 2026-05-10
    const r = nextMonthRange(now)
    expect(r.name).toBe('location_event_2026_06')
    expect(r.from).toBe('2026-06-01')
    expect(r.to).toBe('2026-07-01')
  })

  test('december → january year-boundary rollover', () => {
    const now = new Date(Date.UTC(2026, 11, 15)) // 2026-12-15
    const r = nextMonthRange(now)
    expect(r.name).toBe('location_event_2027_01')
    expect(r.from).toBe('2027-01-01')
    expect(r.to).toBe('2027-02-01')
  })

  test('november → december stays same year', () => {
    const now = new Date(Date.UTC(2026, 10, 1)) // 2026-11-01
    const r = nextMonthRange(now)
    expect(r.name).toBe('location_event_2026_12')
    expect(r.from).toBe('2026-12-01')
    expect(r.to).toBe('2027-01-01')
  })
})
