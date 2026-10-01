// プロジェクトごとのループの画面（loops/index.html）。1プロジェクトに1つの WebContentsView を持ち、
// 切り替えは表示を入れ替えるだけにする（読み込み直さない）。
import { existsSync, readFileSync, watch, type FSWatcher } from 'node:fs'
import { dirname, join } from 'node:path'
import { BrowserWindow, WebContentsView, net, session, webFrameMain, type Session } from 'electron'
import { PANE_PORT, parsePaneUrl } from '@shared/intercept'
import { classifyChange, mergeChanges, type Change } from '@shared/reload'
import type { Project } from '@shared/types'

/** 上のタブの列の高さ。画面（renderer）の CSS と合わせる */
export const TAB_H = 40
/** ループが無いときに、全面のチャットの上に出す一言の高さ。画面（renderer）の CSS の --setup-h と合わせる */
export const SETUP_HEAD_H = 112

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
  private watchers: FSWatcher[] = []
  private shownId: string | null = null
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
    if (p && hasLoops(p.folder)) {
      this.closeSetup(p.id)
      if (!this.views.has(p.id)) this.views.set(p.id, this.create(p))
    } else if (p && !this.setups.has(p.id)) {
      this.setups.set(p.id, this.createSetup(p))
    }
    for (const [id, v] of this.views) v.setVisible(id === this.shownId)
    for (const [id, v] of this.setups) v.setVisible(id === this.shownId)
    this.layout()
  }

  /** 全面のチャットを出しているか（ループがまだ無い） */
  isSetup(id: string): boolean {
    return this.setups.has(id)
  }

  projectOf(webContentsId: number): string | null {
    for (const m of [this.views, this.setups]) for (const [id, v] of m) if (v.webContents.id === webContentsId) return id
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
    return v
  }

  private create(p: Project): WebContentsView {
    const v = this.newView()
    void v.webContents.loadFile(loopsIndex(p.folder))
    this.watch(p.folder, v)
    return v
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

  dispose(): void {
    for (const w of this.watchers) w.close()
    this.watchers = []
  }

  /** AI が loops/ の画面を書き換えたら、書き終わるのを待って読み込み直す */
  private watch(folder: string, v: WebContentsView): void {
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
        }, QUIET_MS)
      })
      w.on('error', () => w.close())
      this.watchers.push(w)
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
    for (const v of this.views.values()) v.setBounds({ x: 0, y: TAB_H, width, height: height - TAB_H })
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

function paneAsset(url: string, paneDir: string): Response | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.port !== PANE_PORT || !u.pathname.startsWith('/_rla/')) return null
  const a = u.pathname === '/_rla/pane.js' ? { file: () => join(paneDir, 'pane.js'), type: 'text/javascript' } : PANE_ASSETS[u.pathname]
  if (!a) return new Response('', { status: 404 })
  return new Response(readFileSync(a.file()), { headers: { 'content-type': a.type + '; charset=utf-8' } })
}
