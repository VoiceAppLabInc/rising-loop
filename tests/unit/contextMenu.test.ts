import { describe, expect, it } from 'vitest'
import { contextItems } from '../../src/shared/contextMenu'

const base = { selectionText: '', linkURL: '', isEditable: false }

describe('contextItems（ループの画面の右クリックのメニューに出す項目）', () => {
  it('何も無い所では「すべて選択」だけ', () => {
    expect(contextItems(base)).toEqual(['selectAll'])
  })
  it('文字を選んでいるときは「コピー」', () => {
    expect(contextItems({ ...base, selectionText: '1日81円' })).toEqual(['copy'])
  })
  it('入力欄の中では 切り取り・コピー・貼り付け・すべて選択', () => {
    expect(contextItems({ ...base, isEditable: true })).toEqual(['cut', 'copy', 'paste', 'selectAll'])
  })
  it('リンクの上では アプリ内で開く・デフォルトのブラウザで開く・リンクをコピー', () => {
    expect(contextItems({ ...base, linkURL: 'https://example.com/a' })).toEqual(['openLinkInApp', 'openLinkExternal', 'copyLink'])
  })
  it('手元のファイルのリンクでは アプリ内で開く・既定のアプリで開く・Finder で表示・リンクをコピー', () => {
    expect(contextItems({ ...base, linkURL: 'file:///x/loops/logs/L01.md' })).toEqual(['openLinkInApp', 'openFileDefault', 'revealFile', 'copyLink'])
  })
  it('リンクの文字を選んでいるときは、コピーとリンクの項目を区切って両方出す', () => {
    expect(contextItems({ ...base, selectionText: '方針', linkURL: 'https://example.com/a' })).toEqual(['copy', 'separator', 'openLinkInApp', 'openLinkExternal', 'copyLink'])
  })
  it('アプリの中で開けないリンク（mailto: など）は、ブラウザで開くとコピーだけ', () => {
    expect(contextItems({ ...base, linkURL: 'mailto:a@example.com' })).toEqual(['openLinkExternal', 'copyLink'])
  })
})
