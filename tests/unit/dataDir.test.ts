import { describe, expect, it } from 'vitest'
import { dataDirOf } from '../../src/main/appSettings'

const base = { appData: '/AS', exists: (_p: string) => false }

describe('データ置き場', () => {
  it('テストなどで指定があれば、それを使う（写さない）', () => {
    expect(dataDirOf({ ...base, packaged: true, override: '/tmp/x' })).toEqual({ dir: '/tmp/x' })
    expect(dataDirOf({ ...base, packaged: false, override: '/tmp/x' })).toEqual({ dir: '/tmp/x' })
  })
  it('開発版は Rising Loop Dev（普段使いのアプリと混ぜない）', () => {
    expect(dataDirOf({ ...base, packaged: false, exists: () => true })).toEqual({ dir: '/AS/Rising Loop Dev' })
  })
  it('普段使いのアプリは Rising Loop。初めてで、前の名前（Rising Loop App）の置き場があれば写して引き継ぐ', () => {
    expect(dataDirOf({ ...base, packaged: true, exists: (p) => p === '/AS/Rising Loop App' })).toEqual({ dir: '/AS/Rising Loop', copyFrom: '/AS/Rising Loop App' })
  })
  it('すでに Rising Loop があれば写さない。前の置き場が無くても写さない', () => {
    expect(dataDirOf({ ...base, packaged: true, exists: () => true })).toEqual({ dir: '/AS/Rising Loop' })
    expect(dataDirOf({ ...base, packaged: true })).toEqual({ dir: '/AS/Rising Loop' })
  })
})
