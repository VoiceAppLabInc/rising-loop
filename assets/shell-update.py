#!/usr/bin/env python3
"""殻（loops/index.html）を雛形と入れ替える。「このループを合わせて」で使う。

  python3 shell-update.py <loops ディレクトリ> [--dry-run]

いまの殻から保存する2か所（CONST ブロック・LOOPS ブロック）を取り、
assets/index.html の同じマーカーの中に入れて書き直す。
共通ファイル rising.css / rising.js / chat-pane.sh / update/common.py（assets/loopdata.py の写し）は assets/ のもので上書きする
（loops/update/ が無ければ作る。ループごとの update/LXX.py はプロジェクトのものなので触らない）。
ループ頁 LXX.html は触らない。ただし雛形と突き合わせて「古いところ」を一覧で出す
（構造版 data-page-schema・雛形にあって頁に無いクラスとデータ属性・雛形の決まった文言・
どの CSS にも定義が無いクラス）。**出すだけで直さない。** 直すかはユーザーが決める。
元の殻は <loops>/.tmp/index-before-update.html に退避する。
依存なし（python3 標準ライブラリのみ）。
"""
import glob, os, re, shutil, sys

ASSETS = os.path.dirname(os.path.abspath(__file__))
#=== 共通ファイル。値を埋めずに、そのままコピーする（assets/ 側の名前, loops/ 側の置き場所）
COMMON = (('rising.css', 'rising.css'), ('rising.js', 'rising.js'), ('chat-pane.sh', 'chat-pane.sh'),
          ('loopdata.py', 'update/common.py'))


#=== 殻の使い方の帯に出る版。**テンプレに直書きしない。** 直書きだと VERSION を上げても
#===   殻は古い番号を出しつづける（1.7.0 を入れたのに v1.6.1 と出て、ユーザーが混乱した）
def put_version(html):
    v = open(os.path.join(os.path.dirname(ASSETS), 'VERSION'), encoding='utf-8').read().strip()
    out, n = re.subn(r'(<span class="ver">)v?[0-9][0-9.]*(</span>)', r'\1v%s\2' % v, html)
    if not n:
        print('  ⚠ 殻に版の置き場（<span class="ver">）がありません')
    return out, v


def block(html, name):
    """<!-- NAME:BEGIN --> 〜 <!-- NAME:END --> の中身。無ければ None"""
    b, e = '<!-- %s:BEGIN -->' % name, '<!-- %s:END -->' % name
    i, j = html.find(b), html.find(e)
    if i < 0 or j < 0 or j < i:
        return None
    return html[i + len(b):j].strip('\n')


def put(html, name, body):
    b, e = '<!-- %s:BEGIN -->' % name, '<!-- %s:END -->' % name
    i, j = html.find(b), html.find(e)
    if i < 0 or j < 0:
        sys.exit('雛形に %s マーカーがありません' % name)
    return html[:i + len(b)] + '\n' + body.strip('\n') + '\n' + html[j:]


#=== 頁の「古いところ」を探す。出すだけで直さない（直すのはユーザーの判断。原理3）
#===   版が離れていると、共通ファイル（rising.css/js）は上書きされるのに、頁の markup と文言だけ古いまま残る。
#===   ★ 判断に使えるものだけを見る。雛形の見本にある部品（ファネル・チェックリスト等）は
#===     そのループが使っていないだけなので、無くても「古い」ではない。
#=== どの頁にも必ずある共通部品（これが欠けていたら古い）
#=== ★ progress-track / progress-fill は 1.7.0 で外した。ゴールの帯は data-rl の bullet に
#===   置き換わるので、無くても古くない（置き換えた頁を「古い」と誤って報告していた）
MUST_CLASSES = ('page', 'screen', 'flow', 'section', 'sec-tab', 'sec-right', 'back', 'cmt', 'upd', 'do',
                'goal-name', 'number-block', 'record-set', 'trial')
#=== 決まった文言（変わったら頁が古い）
FIXED_TEXTS = ('指示する', 'コメント', 'TRIAL に移す', 'ループ一覧')


def _classes(html):
    out = set()
    for m in re.finditer(r'class="([^"]+)"', html):
        for c in m.group(1).split():
            out.add(c)
    return out


def stale(page_html, tpl_html, css):
    """(欠けている共通部品, 欠けている文言, どの CSS にも定義が無いクラス)"""
    pc = _classes(page_html)
    miss_cls = [c for c in MUST_CLASSES if c in tpl_html and c not in pc]
    miss_txt = [t for t in FIXED_TEXTS if t in tpl_html and t not in page_html]
    #=== 使っているのに定義が無い＝rising.css が新しくなって名前が変わった可能性
    nocss = sorted(c for c in pc if ('.' + c) not in css)
    return miss_cls, miss_txt, nocss


def page_schema(html):
    """<html … data-page-schema="N"> の N。無ければ '（無し）'"""
    m = re.search(r'<html[^>]*\bdata-page-schema="([^"]*)"', html)
    return m.group(1) if m else '（無し）'


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('-')]
    #=== 知らないフラグを黙って無視しない（--dryrun のつもりが本番で走るのを防ぐ）
    unknown = [a for a in sys.argv[1:] if a.startswith('-') and a != '--dry-run']
    if unknown:
        print(__doc__, file=sys.stderr)
        print('知らないフラグです: %s' % ' '.join(unknown), file=sys.stderr)
        sys.exit(2)
    dry = '--dry-run' in sys.argv
    if len(args) != 1:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    loops = os.path.abspath(args[0])
    path = os.path.join(loops, 'index.html')
    if not os.path.isfile(path):
        sys.exit('%s がありません' % path)

    cur = open(path, encoding='utf-8').read()
    const, loopsblk = block(cur, 'CONST'), block(cur, 'LOOPS')
    if const is None or loopsblk is None:
        sys.exit('マーカーがありません。1.2.x 形式です。先に split-index.py を実行してください。')

    print('■ 保存した CONST')
    for name in ('PROJECT_DIR', 'SERVICE_NAME', 'PANES'):
        m = re.search(r'\bvar\s+%s\s*=\s*([^\n]*?);\s*$' % name, const, re.M)
        print('  %-12s = %s' % (name, m.group(1) if m else '（見つかりません）'))
    print('■ LOOPS ブロック = %d 文字' % len(loopsblk))

    #=== ループ頁の構造版。ここでは直さない（止めない）。違えば版ごとの移行手順を見てもらう
    want = page_schema(open(os.path.join(ASSETS, 'loop.html'), encoding='utf-8').read())
    old = []
    for f in sorted(glob.glob(os.path.join(loops, 'L*.html'))):
        got = page_schema(open(f, encoding='utf-8').read())
        if got != want:
            old.append((os.path.basename(f), got))
    print('■ ループ頁の構造版（data-page-schema）= %s（雛形）' % want)
    #=== 頁の「古いところ」を一覧で出す。直さない
    tpl_loop = open(os.path.join(ASSETS, 'loop.html'), encoding='utf-8').read()
    css = open(os.path.join(ASSETS, 'rising.css'), encoding='utf-8').read()
    pcss = os.path.join(loops, 'project.css')
    if os.path.isfile(pcss):
        css += open(pcss, encoding='utf-8').read()
    for f in sorted(glob.glob(os.path.join(loops, 'L*.html'))):
        mc, mt, nc = stale(open(f, encoding='utf-8').read(), tpl_loop, css)
        if not (mc or mt or nc):
            continue
        print('  ○ %s の古いところ（直していません。直すかは判断してください）' % os.path.basename(f))
        if mt: print('      決まった文言が無い: %s' % ' / '.join(mt))
        if mc: print('      共通部品が無い    : %s' % ' '.join(mc))
        if nc: print('      CSS に定義が無い  : %s' % ' '.join(nc[:12]) + ('…' if len(nc) > 12 else ''))
    #=== 1.7.0 の図の部品（data-rl）をまだ使っていない頁。★合わせてでは直らない。
    #===   共通ファイルが新しくなっても、頁の中身は書き直さないと見た目は変わらない
    noviz = [os.path.basename(f) for f in sorted(glob.glob(os.path.join(loops, 'L*.html')))
             if 'data-rl' not in open(f, encoding='utf-8').read()]
    if noviz:
        print('  ○ 図の部品をまだ使っていない頁: %s' % ' '.join(noviz))
        print('      「合わせて」では直りません。**頁を作り直すとこの版の図と文になります**')
        print('      1ループ 20〜30 分。ループごとに子を1つ、同時に走らせれば全部でも同じくらい')
    if old:
        for name, got in old:
            print('  ⚠ %s: ループ頁の構造が古い（schema %s → %s）。この版の移行手順を SKILL.md で確認してください'
                  % (name, got, want))

    if dry:
        print('\n--dry-run のため書いていません。')
        return

    tpl = open(os.path.join(ASSETS, 'index.html'), encoding='utf-8').read()
    out = put(put(tpl, 'CONST', const), 'LOOPS', loopsblk)
    out, ver = put_version(out)

    #=== ★ マーカーの外にある独自コードは、この入れ替えで消える。
    #===   黙って消さない。捨てるものを名前で出してから書く
    lost = []
    for m in re.finditer(r'<script\b(?![^>]*\bsrc=)[^>]*>', cur):
        if m.group(0) not in out and 'CONST:BEGIN' not in cur[m.end():m.end() + 200]:
            lost.append('独自の <script>（%d 行目あたり）' % (cur.count('\n', 0, m.start()) + 1))
    for m in re.finditer(r'\bid="([\w-]+)"', cur):
        if ('id="%s"' % m.group(1)) not in out:
            lost.append('id="%s"' % m.group(1))
    if lost:
        print('  ⚠ この入れ替えで**消えるもの**（マーカーの外にあるため）:')
        for x in sorted(set(lost))[:12]:
            print('      %s' % x)
        print('      残したいものは、入れ替えのあとに雛形から作り直した殻へ移してください')
        print('      元の殻は下の退避に丸ごと残ります')

    tmp = os.path.join(loops, '.tmp')
    os.makedirs(tmp, exist_ok=True)
    #=== ★ 退避を上書きしない。2回走らせると1回目の出力で原本が消える
    keep, i = os.path.join(tmp, 'index-before-update.html'), 1
    while os.path.exists(keep):
        keep = os.path.join(tmp, 'index-before-update-%d.html' % i); i += 1
    shutil.copy2(path, keep)
    open(path, 'w', encoding='utf-8').write(out)
    for src, dst in COMMON:
        d = os.path.join(loops, dst)
        os.makedirs(os.path.dirname(d), exist_ok=True)
        shutil.copy2(os.path.join(ASSETS, src), d)

    print('\n上書き: index.html（殻）, %s' % ', '.join(dst for _, dst in COMMON))
    print('殻の版表示: v%s' % ver)
    print('退避: %s' % keep)


if __name__ == '__main__':
    main()
