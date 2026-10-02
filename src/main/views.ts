// プロジェクトごとのループの画面（loops/index.html）。1プロジェクトに1つの WebContentsView を持ち、
// 切り替えは表示を入れ替えるだけにする（読み込み直さない）。
import { existsSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { dirname, join } from 'node:path'
import { BrowserWindow, WebContentsView, net, session, webFrameMain, type Session } from 'electron'
import { PANE_PORT, parsePaneUrl, screenOfUrl } from '@shared/intercept'
import { compareVersions } from '@shared/migrate'
import { navKeyDir } from './platform'
import { classifyChange, mergeChanges, type Change } from '@shared/reload'
import type { Project } from '@shared/types'

/** 上のタブの列の高さ。画面（renderer）の CSS と合わせる */
export const TAB_H = 48
/** ループが無いときに、全面のチャットの上に出す一言の高さ。画面（renderer）の CSS の --setup-h と合わせる */
export const SETUP_HEAD_H = 112

/** 右のチャットの窓の幅。殻が窓を持っていた頃（2.2.0 より前）の殻の --pane と同じ */
export const PANE_W = 360
/** この版からの殻は右の窓を持たない。アプリが自分の窓としてループの画面の右に並べる */
const APP_CHAT_FROM = '2.2.0'

/** 変更が止まってから読み込み直すまでの時間（AI が書いている途中の画面を出さない） */
const QUIET_MS = 1500

/** ループの画面だけが使うセッション。右の窓の横取りをアプリの周りの画面に効かせないため */
const PARTITION = 'persist:loops'

export const loopsIndex = (folder: string) => join(folder, 'loops', 'index.html')
export const hasLoops = (folder: string) => existsSync(loopsIndex(folder))

export interface PaneOpen {
  projectId: string | null
  folder: string
  screen: string
}

/** 右の窓のページが読み込むもの。xterm.js は node_modules から、右の窓の動きは resources/pane/ から配る */
const xtermDir = () => dirname(require.resolve('@xterm/xterm/package.json'))
const fitDir = () => dirname(require.resolve('@xterm/addon-fit/package.json'))
const PANE_ASSETS: Record<string, { file: () => string; type: string }> = {
  '/_rla/xterm.js': { file: () => join(xtermDir(), 'lib', 'xterm.js'), type: 'text/javascript' },
  '/_rla/xterm.css': { file: () => join(xtermDir(), 'css', 'xterm.css'), type: 'text/css' },
  '/_rla/addon-fit.js': { file: () => join(fitDir(), 'lib', 'addon-fit.js'), type: 'text/javascript' }
}

export class ProjectViews {
  private views = new Map<string, WebContentsView>()
  /** ループが無いプロジェクトの、全面のチャット（右の窓と同じページ） */
  private setups = new Map<string, WebContentsView>()
  private watchers = new Map<string, FSWatcher>()
  /** 右の窓を開いているか（プロジェクトごと。既定は開く）。2.1.x の殻には rising.js の LOOP_SET_PANE で当てる */
  private panes = new Map<string, boolean>()
  /** 2.2.0 からの殻のプロジェクトの、アプリが出す右のチャットの窓 */
  private chats = new Map<string, WebContentsView>()
  /** ループの画面の殻が右の窓を持たないか（2.2.0 から）と、チャットを付ける画面（殻の CONST の PANES）。読み込むたびに読み直す */
  private shells = new Map<string, { appChat: boolean; panes: string[] }>()
  private changed: () => void = () => undefined
  private added: () => void = () => undefined
  private navigated: () => void = () => undefined
  private shownId: string | null = null
  private projects = new Map<string, Project>()
  /** アプリのダイアログを出しているあいだは、重ねた画面を隠す（ダイアログが下に隠れるため） */
  private covered = false
  private ses: Session

  constructor(
    private win: BrowserWindow,
    private preload: string,
    private paneDir: string,
    private throttle: boolean,
    private onPane: (p: PaneOpen) => void
  ) {
    this.ses = session.fromPartition(PARTITION)
    // スキルの画面は右の窓に ttyd（localhost:7681）を開く。それをアプリが受け、アプリのチャットを出す
    this.ses.protocol.handle('http', (req) => {
      const asset = paneAsset(req.url, this.paneDir)
      if (asset) return asset
      const pane = parsePaneUrl(req.url)
      if (!pane) return net.fetch(req, { bypassCustomProtocolHandlers: true })
      this.onPane({ projectId: this.shownId, ...pane })
      return new Response(PANE_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } })
    })
    win.on('resize', () => this.layout())
  }

  /**
   * 見せるプロジェクトを切り替える。loops/ があればループの画面、無ければ全面のチャットを出す。
   * loops/ ができたら全面のチャットを閉じる（AI は main の側で動き続け、会話は一覧のチャットとして続く）
   */
  show(p: Project | null): void {
    this.shownId = p?.id ?? null
    if (p) this.projects.set(p.id, p)
    if (p && hasLoops(p.folder)) {
      this.closeSetup(p.id)
      if (!this.views.has(p.id)) this.views.set(p.id, this.create(p))
    } else if (p && !this.setups.has(p.id)) {
      this.setups.set(p.id, this.createSetup(p))
    }
    this.layout()
  }

  setCovered(on: boolean): void {
    this.covered = on
    this.layout()
  }

  /** 見えているループの画面（無ければ全面のチャット）に入力を向ける。どちらも無ければ false */
  focusShown(): boolean | undefined {
    const id = this.shownId
    const v = id ? (this.views.get(id) ?? this.setups.get(id)) : undefined
    if (!v || v.webContents.isDestroyed()) return undefined
    v.webContents.focus()
    return true
  }

  /** 全面のチャットを出しているか（ループがまだ無い） */
  isSetup(id: string): boolean {
    return this.setups.has(id)
  }

  projectOf(webContentsId: number): string | null {
    for (const m of [this.views, this.setups, this.chats]) for (const [id, v] of m) if (v.webContents.id === webContentsId) return id
    return null
  }

  private newView(): WebContentsView {
    const v = new WebContentsView({
      webPreferences: {
        partition: PARTITION,
        preload: this.preload,
        // ループの頁は殻の中の iframe なので、iframe にも preload を効かせる
        nodeIntegrationInSubFrames: true,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: this.throttle
      }
    })
    this.win.contentView.addChildView(v)
    // 後から足した画面はいちばん上に来るので、main が透明な層（カード・ダイアログ）を上に戻す
    queueMicrotask(() => this.added())
    return v
  }

  private create(p: Project): WebContentsView {
    const v = this.newView()
    void v.webContents.loadFile(loopsIndex(p.folder))
    v.webContents.on('did-finish-load', () => void this.readShell(p, v))
    // 画面の切り替えは殻の hash（#s-L01）。右のチャットをその画面のものにする
    v.webContents.on('did-navigate-in-page', () => {
      this.syncChat(p)
      this.navigated()
    })
    v.webContents.on('did-navigate', () => this.navigated())
    // Chrome・Safari と同じキーで戻る・進む（右のチャットの窓では効かない。そちらは入力の行の移動に使う）
    v.webContents.on('before-input-event', (e, input) => {
      const dir = navKeyDir(input, process.platform)
      if (!dir) return
      e.preventDefault()
      this.go(p.id, dir)
    })
    this.watch(p.id, p.folder, v)
    return v
  }

  /**
   * 読み込んだ殻を調べる。2.2.0 からの殻なら、アプリの右の窓を出してその画面のチャットにする。
   * それより前の殻は自分の中に右の窓を持つので、開閉の状態だけ当て直す（殻は読み込むたびに開いた状態で始まる）
   */
  private async readShell(p: Project, v: WebContentsView): Promise<void> {
    const r = (await v.webContents
      .executeJavaScript(
        `({ ver: (document.querySelector('span.ver') || {}).textContent || '', panes: (typeof PANES !== 'undefined' && Array.isArray(PANES)) ? PANES.map(String) : [] })`
      )
      .catch(() => null)) as { ver: string; panes: string[] } | null
    if (v.webContents.isDestroyed()) return
    const ver = /v?(\d+\.\d+\.\d+)/.exec(r?.ver ?? '')?.[1]
    const appChat = !!ver && compareVersions(ver, APP_CHAT_FROM) >= 0
    this.shells.set(p.id, { appChat, panes: r?.panes ?? [] })
    if (!appChat) this.closeChat(p.id)
    this.applyPane(p.id)
    this.syncChat(p)
    this.layout()
  }

  /** アプリが右のチャットの窓を出すプロジェクトか（殻が 2.2.0 から） */
  isAppChat(id: string): boolean {
    return this.shells.get(id)?.appChat ?? false
  }

  /** 右の窓の開閉（アプリのタブの列の［AI の窓］・指示文が届いたとき）。2.1.0 より前の殻は自分のボタンで開閉する */
  setPane(id: string, on: boolean): void {
    this.panes.set(id, on)
    this.applyPane(id)
    const p = this.projects.get(id)
    if (p) this.syncChat(p)
    this.layout()
  }

  paneOpen(id: string): boolean {
    return this.panes.get(id) ?? true
  }

  private applyPane(id: string): void {
    const v = this.views.get(id)
    if (!v || v.webContents.isDestroyed() || !this.panes.has(id) || this.isAppChat(id)) return
    void v.webContents.executeJavaScript(`window.LOOP_SET_PANE && window.LOOP_SET_PANE(${this.paneOpen(id)})`).catch(() => undefined)
  }

  /**
   * アプリの右の窓に、いま見えている画面のチャットを出す。閉じているあいだは作らない（チャットを起こさない）。
   * 窓の中は画面ごとのチャットを重ねて置き、表示だけ切り替える（一度つないだチャットは切らない）
   */
  private syncChat(p: Project): void {
    const sh = this.shells.get(p.id)
    const v = this.views.get(p.id)
    if (!sh?.appChat || !v || v.webContents.isDestroyed() || !this.paneOpen(p.id)) return
    const at = screenOfUrl(v.webContents.getURL())
    const screen = at === 's-list' || sh.panes.includes(at) ? at : 's-list'
    let c = this.chats.get(p.id)
    if (!c) {
      c = this.newView()
      c.setBackgroundColor('#16171a')
      this.chats.set(p.id, c)
      void c.webContents.loadURL(`http://localhost:${PANE_PORT}/_rla/chat.html?arg=${encodeURIComponent(p.folder)}`)
      this.layout()
    }
    const show = `window.RLA_SHOW && window.RLA_SHOW(${JSON.stringify(screen)})`
    if (c.webContents.isLoading()) c.webContents.once('did-finish-load', () => void c!.webContents.executeJavaScript(show).catch(() => undefined))
    else void c.webContents.executeJavaScript(show).catch(() => undefined)
  }

  private closeChat(id: string): void {
    const c = this.chats.get(id)
    if (!c) return
    this.chats.delete(id)
    this.win.contentView.removeChildView(c)
    c.webContents.close()
  }

  /** プロジェクトを外す・フォルダを変えるとき。そのプロジェクトの画面と見張りを捨てる */
  removeProject(id: string): void {
    this.closeSetup(id)
    this.closeChat(id)
    this.shells.delete(id)
    this.projects.delete(id)
    const v = this.views.get(id)
    if (v) {
      this.views.delete(id)
      this.win.contentView.removeChildView(v)
      v.webContents.close()
    }
    this.watchers.get(id)?.close()
    this.watchers.delete(id)
    this.layout()
  }

  private createSetup(p: Project): WebContentsView {
    const v = this.newView()
    void v.webContents.loadURL(`http://localhost:${PANE_PORT}/?arg=${encodeURIComponent(p.folder)}&arg=s-list`)
    return v
  }

  private closeSetup(id: string): void {
    const v = this.setups.get(id)
    if (!v) return
    this.setups.delete(id)
    this.win.contentView.removeChildView(v)
    v.webContents.close()
  }

  /** 戻る・進むができるか。履歴はプロジェクト（タブ）ごとのループの画面が持つ（殻が画面を切り替えるたびに hash の履歴を積む） */
  navState(id: string): { back: boolean; forward: boolean } {
    const v = this.views.get(id)
    if (!v || v.webContents.isDestroyed()) return { back: false, forward: false }
    const h = v.webContents.navigationHistory
    return { back: h.canGoBack(), forward: h.canGoForward() }
  }

  go(id: string, dir: -1 | 1): void {
    const v = this.views.get(id)
    if (!v || v.webContents.isDestroyed()) return
    const h = v.webContents.navigationHistory
    if (dir < 0 && h.canGoBack()) h.goBack()
    if (dir > 0 && h.canGoForward()) h.goForward()
  }

  /** ループの画面で画面が移ったときに呼ぶ */
  onNavigated(cb: () => void): void {
    this.navigated = cb
  }

  /** 画面を足したあとに呼ぶ */
  onViewAdded(cb: () => void): void {
    this.added = cb
  }

  /** loops/ を読み込み直したあとに呼ぶ */
  onLoopsChanged(cb: () => void): void {
    this.changed = cb
  }

  dispose(): void {
    for (const w of this.watchers.values()) w.close()
    this.watchers.clear()
  }

  /** AI が loops/ の画面を書き換えたら、書き終わるのを待って読み込み直す */
  private watch(id: string, folder: string, v: WebContentsView): void {
    let changes: Change[] = []
    let timer: NodeJS.Timeout | null = null
    try {
      const w = watch(join(folder, 'loops'), (_event, name) => {
        const c = classifyChange(name == null ? null : String(name))
        if (!c) return
        changes.push(c)
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          const m = mergeChanges(changes)
          changes = []
          if (m && !v.webContents.isDestroyed()) void this.reload(v, m)
          if (m) this.changed()
        }, QUIET_MS)
      })
      w.on('error', () => w.close())
      this.watchers.set(id, w)
    } catch {
      // 見張れないフォルダ（消された・権限が無い）は、読み込み直さないだけにする
    }
  }

  /** 殻が変わったら画面全体、頁だけならその頁の iframe を読み込み直す。右の窓は開き直されても続きを出す */
  private async reload(v: WebContentsView, m: 'shell' | { pages: string[] }): Promise<void> {
    const wc = v.webContents
    if (m === 'shell') {
      wc.reload()
      return
    }
    for (const page of m.pages) {
      // 見えていない頁は、次に開いたときに新しいものが読まれる
      const f = wc.mainFrame.framesInSubtree.find((x) => x !== wc.mainFrame && x.url.startsWith('file:') && decodeURI(new URL(x.url).pathname).endsWith('/' + page))
      if (!f) continue
      const pos = (await f.executeJavaScript('[scrollX, scrollY]').catch(() => null)) as [number, number] | null
      if (pos) {
        const node = f.frameTreeNodeId
        const restore = (_e: unknown, _isMain: boolean, pid: number, rid: number) => {
          const fr = webFrameMain.fromId(pid, rid)
          if (!fr || fr.frameTreeNodeId !== node) return
          wc.off('did-frame-finish-load', restore)
          void fr.executeJavaScript(`scrollTo(${pos[0]}, ${pos[1]})`).catch(() => undefined)
        }
        wc.on('did-frame-finish-load', restore)
      }
      f.reload()
    }
  }

  private layout(): void {
    const [width, height] = this.win.getContentSize()
    for (const [id, v] of this.views) v.setVisible(!this.covered && id === this.shownId)
    for (const [id, v] of this.setups) v.setVisible(!this.covered && id === this.shownId)
    for (const [id, v] of this.chats) v.setVisible(!this.covered && id === this.shownId && this.paneOpen(id))
    const y = TAB_H
    const h = Math.max(0, height - y)
    for (const [id, v] of this.views) {
      // アプリが右の窓を出すときは、ループの画面をその幅だけ狭める
      const w = this.chats.has(id) && this.paneOpen(id) ? Math.max(0, width - PANE_W) : width
      v.setBounds({ x: 0, y, width: w, height: h })
    }
    for (const c of this.chats.values()) c.setBounds({ x: Math.max(0, width - PANE_W), y, width: Math.min(PANE_W, width), height: h })
    const top = TAB_H + SETUP_HEAD_H
    for (const v of this.setups.values()) v.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) })
  }
}

/** 右の窓のページ。中身は resources/pane/pane.js が xterm.js で描く */
const PANE_HTML = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/_rla/xterm.css">
<style>html,body{margin:0;height:100%;background:#16171a;overflow:hidden}#term{position:absolute;inset:6px 0 0 8px}</style>
</head><body><div id="term"></div>
<script src="/_rla/xterm.js"></script><script src="/_rla/addon-fit.js"></script><script src="/_rla/pane.js"></script>
</body></html>`

/**
 * アプリが出す右のチャットの窓（2.2.0 からの殻）。画面ごとのチャット（PANE_HTML）を iframe で重ねて置き、
 * main が RLA_SHOW(画面ID) で見せるものを切り替える。iframe の src は二度と触らない（触るとつなぎ直しになる）。
 * 隠すのは visibility。display:none だと幅が 0 になり、戻したときにターミナルが組み直されて崩れる
 */
const CHAT_HTML = `<!doctype html><html><head><meta charset="utf-8">
<style>html,body{margin:0;height:100%;background:#16171a;overflow:hidden}
body{border-left:1px solid #2a2c31;box-sizing:border-box}
iframe{position:absolute;inset:0 0 0 1px;width:calc(100% - 1px);height:100%;border:0;background:#16171a;visibility:hidden}
iframe.on{visibility:visible}</style>
</head><body><script>
(function () {
  var folder = new URLSearchParams(location.search).get('arg') || ''
  var frames = {}
  window.RLA_SHOW = function (screen) {
    if (!frames[screen]) {
      var f = document.createElement('iframe')
      f.title = 'AI のチャット'
      f.src = '/?arg=' + encodeURIComponent(folder) + '&arg=' + encodeURIComponent(screen)
      document.body.appendChild(f)
      frames[screen] = f
    }
    for (var k in frames) frames[k].classList.toggle('on', k === screen)
  }
})()
</script></body></html>`

function paneAsset(url: string, paneDir: string): Response | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.port !== PANE_PORT || !u.pathname.startsWith('/_rla/')) return null
  if (u.pathname === '/_rla/chat.html') return new Response(CHAT_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } })
  const a = u.pathname === '/_rla/pane.js' ? { file: () => join(paneDir, 'pane.js'), type: 'text/javascript' } : PANE_ASSETS[u.pathname]
  if (!a) return new Response('', { status: 404 })
  return new Response(readFileSync(a.file()), { headers: { 'content-type': a.type + '; charset=utf-8' } })
}
