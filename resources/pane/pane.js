// 右の窓の中身。アプリが http://localhost:7681/ として出す（スキルの rising.js はここを ttyd のつもりで開く）。
// 入出力は preload（src/preload/loops.ts）の window.rlaPane を通して main の疑似ターミナルとやり取りする。
;(function () {
  var args = new URLSearchParams(location.search).getAll('arg')
  var screen = args[1] || 's-list'
  var term = new Terminal({
    fontFamily: '"SF Mono", Menlo, "Cascadia Mono", Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.15,
    cursorBlink: true,
    scrollback: 10000,
    theme: { background: '#16171a', foreground: '#e6e6e6' }
  })
  var fit = new FitAddon.FitAddon()
  term.loadAddon(fit)
  term.open(document.getElementById('term'))
  window.__rlaTerm = term // 画面の流れのテストで中身を読む
  var api = window.rlaPane
  api.onData(function (d) { term.write(d) })
  term.onData(function (d) { api.input(screen, d) })
  // コピーと貼り付け。どのキーで何をするかは preload の clip.action（src/shared/termKeys.ts）が決める。
  // Mac はメニューの ⌘C・⌘V が効くので素通し。Windows・Linux は Ctrl+C（選んでいるとき）・Ctrl+V・右クリック
  // （src/renderer/src/termClipboard.ts と同じつなぎ。変えるときは両方そろえる）
  var clip = api.clip
  if (clip) {
    var copySel = function () { clip.copy(term.getSelection()); term.clearSelection() }
    var pasteClip = function () { clip.paste().then(function (t) { if (t) term.paste(t) }) }
    term.attachCustomKeyEventHandler(function (e) {
      var a = clip.action({ type: e.type, key: e.key, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey }, term.hasSelection())
      if (a === 'pass') return true
      e.preventDefault() // ブラウザの貼り付けも止める（止めないと二重に貼られる）
      if (a === 'copy') copySel()
      if (a === 'paste') pasteClip()
      return false
    })
    document.getElementById('term').addEventListener('contextmenu', function (e) {
      if (!clip.rightClick) return
      e.preventDefault()
      if (term.hasSelection()) copySel()
      else pasteClip()
    })
  }
  function refit() {
    // 隠れている窓（ほかの画面のチャット）は大きさが 0 になるので、そのときは何もしない
    if (!document.body.clientWidth || !document.body.clientHeight) return
    try { fit.fit() } catch (e) { return }
    api.resize(screen, term.cols, term.rows)
  }
  // 隠れた状態で開かれたとき（アプリのダイアログの最中など）は大きさを測れないので、決まった大きさで始め、見えたときに合わせる
  if (document.body.clientWidth && document.body.clientHeight) { try { fit.fit() } catch (e) {} }
  api.attach(screen, term.cols, term.rows)
  new ResizeObserver(refit).observe(document.body)
  term.focus()
})()
