import { describe, expect, it } from 'vitest'
import { AUTO_UPDATE_TEXT, autoUpdateDue, autoUpdateLabel, nextAutoUpdate } from '../../src/shared/autoUpdate'

// 時刻はその PC の時計（ローカル時刻）で決めるので、テストもローカル時刻で日時を作る
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m)
const iso = (d: number, h: number, m = 0) => at(d, h, m).toISOString()

describe('nextAutoUpdate（次に全ループ更新を送る日時）', () => {
  it('しないにしていれば null', () => {
    expect(nextAutoUpdate(undefined)).toBeNull()
    expect(nextAutoUpdate({ on: false, every: 1, at: '08:00', since: iso(28, 7) })).toBeNull()
  })
  it('まだ送っていなければ、するにした時より後の最初の時刻（7時にするにしたら、その日の8時）', () => {
    expect(nextAutoUpdate({ on: true, every: 1, at: '08:00', since: iso(28, 7) })).toEqual(at(28, 8))
  })
  it('時刻を過ぎてからするにしたら、次の日の時刻（すぐには送らない）', () => {
    expect(nextAutoUpdate({ on: true, every: 7, at: '08:00', since: iso(28, 15) })).toEqual(at(29, 8))
  })
  it('送ったことがあれば、送った日から間隔の日数後の時刻（遅れて10時に送っても、次は時刻どおり）', () => {
    expect(nextAutoUpdate({ on: true, every: 1, at: '08:00', since: iso(20, 7), last: iso(28, 10, 5) })).toEqual(at(29, 8))
    expect(nextAutoUpdate({ on: true, every: 2, at: '08:00', since: iso(20, 7), last: iso(28, 8) })).toEqual(at(30, 8))
    expect(nextAutoUpdate({ on: true, every: 7, at: '21:30', since: iso(20, 7), last: iso(28, 21, 30) })).toEqual(new Date(2026, 10, 4, 21, 30))
  })
})

describe('autoUpdateDue（いま送るか）', () => {
  const a = { on: true, every: 1 as const, at: '08:00', since: iso(27, 12), last: iso(27, 12) }
  it('時刻より前は送らない', () => {
    expect(autoUpdateDue(a, at(28, 7, 59))).toBe(false)
  })
  it('時刻ちょうど・過ぎていれば送る（8時にスリープしていて10時に起きたら、10時に送る）', () => {
    expect(autoUpdateDue(a, at(28, 8))).toBe(true)
    expect(autoUpdateDue(a, at(28, 10))).toBe(true)
  })
  it('何日も寝ていても、送るのは1回（送ったら次は翌日の時刻）', () => {
    expect(autoUpdateDue(a, at(31, 10))).toBe(true)
    expect(autoUpdateDue({ ...a, last: iso(31, 10) }, at(31, 10, 1))).toBe(false)
  })
  it('しないにしていれば送らない', () => {
    expect(autoUpdateDue({ ...a, on: false }, at(28, 10))).toBe(false)
  })
})

describe('AUTO_UPDATE_TEXT', () => {
  it('一覧の［全ループ更新］と同じ形の指示文（task は全ループの更新）', () => {
    expect(AUTO_UPDATE_TEXT).toMatch(/^---\nloop: all\nsection: ALL\nrule: まず \/rising-loop を呼び出して最新の手順を読み、それに従うこと\ntask: \|\n {2}loops\/ の全ループを更新して\n/)
    expect(AUTO_UPDATE_TEXT.endsWith('\n---')).toBe(true)
  })
})

describe('autoUpdateLabel（タブの札に出す言い方）', () => {
  it('間隔と時刻（時の頭の 0 は付けない）', () => {
    expect(autoUpdateLabel({ on: true, every: 1, at: '08:00' })).toBe('毎日 8:00')
    expect(autoUpdateLabel({ on: true, every: 7, at: '21:30' })).toBe('毎週 21:30')
  })
})
