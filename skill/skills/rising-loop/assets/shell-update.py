#!/usr/bin/env python3
"""殻（loops/index.html）を雛形と入れ替える。「このループを合わせて」で使う。

  python3 shell-update.py <loops ディレクトリ> [--dry-run]

いまの殻から保存する2か所（CONST ブロック・LOOPS ブロック）を取り、
assets/index.html の同じマーカーの中に入れて書き直す。
共通ファイル rising.css / rising.js / update/common.py（assets/loopdata.py の写し）は assets/ のもので上書きする
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
#===   chat-pane.sh は配らない（右のチャットはアプリが出す）。プロジェクトに残っている loops/chat-pane.sh は消さない
COMMON = (('rising.css', 'rising.css'), ('rising.js', 'rising.js'),
          ('loopdata.py', 'update/common.py'))
#=== 雛形から消した部品の id。移し直させないので「消えるもの」に出さない
#===   2.0.0: ttyd の説明・アップデートのボタン・コピーの知らせ／2.1.0: 使い方の窓と右上のボタン（アプリのタブの列に移した）
DROPPED_IDS = {'cc-ask', 'cc-help', 'cc-help-close', 'cc-help-t', 'rl-update', 'toast', 'toast-body',
               'topbtns', 'howto-btn', 'cc-toggle', 'howto', 'howto-t', 'howto-close', 'hw-ah'}


#=== 殻の使い方の帯に出る版。**テンプレに直書きしない。** 直書きだと VERSION を上げても
#===   殻は古い番号を出しつづける（1.7.0 を入れたのに v1.6.1 と出て、ユーザーが混乱した）
def put_version(html):
    v = open(os.path.join(os.path.dirname(ASSETS), 'VERSION'), encoding='utf-8').read().strip()
    out, n = re.subn(r'(<span class="ver"[^>]*>)v?[0-9][0-9.]*(</span>)', r'\1v%s\2' % v, html)
    if not n:
        print('  ⚠ 殻に版の置き場（<span class="ver">）がありません')
    return out, v


def ver_of():
    return open(os.path.join(os.path.dirname(ASSETS), 'VERSION'), encoding='utf-8').read().strip()


def plain_block(found, plain, npages, ver, dry=False):
    """★マーケターにそのまま見せる欄。AI は言い換えない。
    用語・ファイル名を入れない。★聞かない（1.7.4 まで「直しますか」と聞いていて、毎回そこで止まっていた）。
    古いところがあれば、これから直すこと・何分か・「数字や施策の記録は消えません」を伝えるだけ。
    ★画面がまだ変わっていないのに「新しくなった」と言わない（1.7.4 で言ってしまい、見た目は古いままだった）"""
    bar = '━' * 40
    head = '\n%s\nマーケター向け（この欄を言い換えずに、そのまま見せる）%s\n%s\n' % (
        bar, '　※ --dry-run なので、まだ入れ替えていない' if dry else '', bar)
    if not found:
        return head + '最新版（%s）にしました。\n%s' % (ver, bar)
    #=== ★所要時間は「古いものだけ」で見積もる。一覧だけなら数分（全頁と言うと過大に見える）
    #===   頁は子が同時に作り直すので、数が増えても長くならない（1.7.4 の試しで6頁が10分かからなかった）
    took = '数分' if npages == 0 else '10分ほど'
    lines = ['最新版（%s）を入れました。画面の見た目は、まだ前のままです。' % ver,
             '続けて、画面を新しい形に直します（%s）。直るとこう変わります。' % took]
    lines += ['- ' + x for x in (plain or ['いまの版の見た目と書き方になる'])]
    lines += ['', '数字や施策の記録は消えません。終わったらお知らせします。']
    return head + '\n'.join(lines) + '\n' + bar


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
    #=== 使っているのに定義が無い＝rising.css が新しくなって名前が変わった可能性。
    #===   ★見本の頁も使っている名前は外す（record-section のような目印用。毎回全頁に出て、誰も直せなかった）
    tc = _classes(tpl_html)
    nocss = sorted(c for c in pc if ('.' + c) not in css and c not in tc)
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
    #=== 版が上がっても「合わせて」では直らないもの。★共通ファイルは新しくなるが、
    #===   頁の markup は書き直さないと変わらない。黙って終えると「更新したのに何も変わらない」
    #===   になる（1.7.0 で実際に起きた）。ここで気づけるように、頁を1つずつ見て名前で出す
    #=== (目印, あれば古いか, AI 向けの説明, ★マーケター向けの一文)。
    #===   ★マーケター向けの文は「画面で何が変わるか」だけを言う。ファイル名・用語を入れない。
    #===     AI はこの文を言い換えずに見せる（言い換えると用語が漏れる。1.7.1 で実際に漏れた）
    OLD_PAGE = (
        ('data-rl', False, '図の部品をまだ使っていない',
         'グラフが見やすい図になり、長い文が短くなる'),
        ('tid-pill', False, '施策の番号を画面に出していない',
         '施策に番号が付き、本文から飛べる'),
        ('done-tag', True, '施策に「完了」が残っている', None),
    )
    #=== 実行中の施策に飛び先（id="trial-…"）が無い頁。実行中の施策がある頁だけ見る
    TRIAL_ID = ('実行中の施策に飛び先が無い', '実行中の施策にも、本文の番号から飛べる')
    pages = sorted(glob.glob(os.path.join(loops, 'L*.html')))
    found, plain, oldpages = False, [], set()
    for mark, want_present, what, say in OLD_PAGE:
        hit = [os.path.basename(f) for f in pages
               if (mark in open(f, encoding='utf-8').read()) == want_present]
        if hit:
            found = True
            oldpages.update(hit)
            print('  ○ %s頁: %s' % (what, ' '.join(hit)))
            if say and say not in plain:
                plain.append(say)
    hit = [os.path.basename(f) for f in pages
           if 'class="trial"' in open(f, encoding='utf-8').read()
           and 'id="trial-' not in open(f, encoding='utf-8').read()]
    if hit:
        found = True
        oldpages.update(hit)
        print('  ○ %s頁: %s' % (TRIAL_ID[0], ' '.join(hit)))
        plain.append(TRIAL_ID[1])
    #=== 一覧の行は LOOPS ブロックごと引き継ぐので、古い形のまま残る。これも知らせる
    if 'loop-bar' in loopsblk and 'data-rl' not in loopsblk:
        found = True
        print('  ○ 一覧の行が古い形（帯だけで、目盛りも向きも無い）')
        plain.insert(0, 'ループ一覧で、はじめより下がったループが赤で分かる')
    #=== 構造が古い頁（1.4.x 以前）も作り直しの中で移す。マーケターに版の話はしない
    if old:
        found = True
        for name, got in old:
            oldpages.add(name)
            print('  ○ %s: 構造が古い（schema %s → %s）。作り直しの中で移す' % (name, got, want))
    tpl = open(os.path.join(ASSETS, 'index.html'), encoding='utf-8').read()
    out = put(put(tpl, 'CONST', const), 'LOOPS', loopsblk)
    out, ver = put_version(out)

    #=== ★ マーカーの外にある独自コードは、この入れ替えで消える。
    #===   黙って消さない。捨てるものを名前で出す。--dry-run でも出す（書く前に分からないと意味がない）
    #===   スクリプトは開始タグでなく中身で比べる。`<script>` は雛形にもあるので、タグでは独自のものが見えない
    squash = lambda t: re.sub(r'\s+', '', t)
    sout = squash(out)
    lost = []
    for m in re.finditer(r'<script\b(?![^>]*\bsrc=)[^>]*>(.*?)</script>', cur, re.S):
        body = m.group(1)
        if 'CONST:BEGIN' in body or not body.strip():
            continue                     # 雛形の CONST 入りのスクリプト。中身は CONST だけ引き継ぐ
        if squash(body) not in sout:
            lost.append('独自の <script>（%d 行目あたり）' % (cur.count('\n', 0, m.start()) + 1))
    for m in re.finditer(r'\bid="([\w-]+)"', cur):
        if m.group(1) not in DROPPED_IDS and ('id="%s"' % m.group(1)) not in out:
            lost.append('id="%s"' % m.group(1))
    if lost:
        print('  ⚠ この入れ替えで**消えるもの**（マーカーの外にあるため）:')
        for x in sorted(set(lost))[:12]:
            print('      %s' % x)
        print('      残したいものは、入れ替えのあとに雛形から作り直した殻へ移してください')
        print('      元の殻は下の退避に丸ごと残ります')

    if dry:
        print(plain_block(found, plain, len(oldpages), ver_of(), dry=True))
        print('\n--dry-run のため書いていません。')
        return

    tmp = os.path.join(loops, '.tmp')
    os.makedirs(tmp, exist_ok=True)
    #=== ★ 退避を上書きしない。2回走らせると1回目の出力で原本が消える
    keep, i = os.path.join(tmp, 'index-before-update.html'), 1
    while os.path.exists(keep):
        keep = os.path.join(tmp, 'index-before-update-%d.html' % i); i += 1
    shutil.copy2(path, keep)
    #=== ★共通ファイルも控える。殻だけ控えていて「元の枠は控えに残る」と合わなかった
    ckeep, i = os.path.join(tmp, 'common-before-update'), 1
    while os.path.exists(ckeep):
        ckeep = os.path.join(tmp, 'common-before-update-%d' % i); i += 1
    for _, dst in COMMON:
        d = os.path.join(loops, dst)
        if os.path.isfile(d):
            os.makedirs(os.path.dirname(os.path.join(ckeep, dst)), exist_ok=True)
            shutil.copy2(d, os.path.join(ckeep, dst))
    open(path, 'w', encoding='utf-8').write(out)
    for src, dst in COMMON:
        d = os.path.join(loops, dst)
        os.makedirs(os.path.dirname(d), exist_ok=True)
        shutil.copy2(os.path.join(ASSETS, src), d)

    print('\n上書き: index.html（殻）, %s' % ', '.join(dst for _, dst in COMMON))
    print('殻の版表示: v%s' % ver)
    print(plain_block(found, plain, len(oldpages), ver))
    print('退避: %s' % keep)
    print('退避（共通ファイル）: %s' % ckeep)


if __name__ == '__main__':
    main()
