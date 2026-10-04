#!/usr/bin/env python3
"""一覧の「施策の流れ」（HISTORY）の中身を、全頁の `LOOP_DATA` から集めて `loops/history.js` に書く。

プロジェクトには `loops/update/history.py` として写される（common.py と同じく「合わせて」で上書きされる。プロジェクト側で書き換えない）。

  python3 loops/update/history.py            # プロジェクトの根から。loops/history.js を書く
  python3 loops/update/history.py --dry-run  # 書かずに、何ループ出すかだけ出す

★一覧（殻の LOOPS）を直したら、続けてこれを流す。一覧はループを直したら同じターンで必ず直すので、ここで漏れない。

読むもの（各頁の LOOP_DATA）:
  short（無ければ title）・hist.unit・hist.target・metric.start・hist.points（計測の記録。数字はここからだけ拾う）
  bottlenecks: [{ from, text }]   古い順、最後がいま（value は読まない。2.5.0 の頁にあっても無視する）
  records[]: id・short（無ければ title）・done・grade
  trials[]:  id・short（無ければ title）・started（無ければ日付なし＝いまの期間）
書くもの:
  window.HISTORY_DATA = { generated, loops: [{ id, name, unit, lowerBetter, now, nowAt, bottlenecks: [{ from, text, a, b }], period, trials }] }
  a・b は、その期間の始まりと終わりの計測の点 { at, value }（無ければ null）:
    a = from 以前で最後の点（無ければ期間の中の最初の点）、b = 期間の中（from〜次の from。最後は〜今日）の最後の点
  period は bottlenecks が無いループの a・b（最初の施策の日から）。
  全頁を出す（bottlenecks や施策が無くても。描く側が「記録なし」「まだ施策がありません」にする）。
  ループの並びは殻 index.html の一覧の行（data-go="s-LXX"）の順。行に無い頁は名前の順で後ろ。
  中身が前と同じなら書かない（generated だけの差で書き換えない）。
依存なし（python3 標準ライブラリと、同じフォルダの common.py）。
"""
import datetime as _dt
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import load  # noqa: E402

HEAD = '// 一覧の「施策の流れ」の中身。loops/update/history.py が全頁の LOOP_DATA から書く（手で直さない）\n'


def _str(v):
    return v.strip() if isinstance(v, str) and v.strip() else None


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def span(pts, start, end):
    """期間 start〜end（end が None なら終わりなし）の始まりと終わりの点。pts は日付の順の (at, value)"""
    inside = [p for p in pts if (not start or p[0] >= start) and (end is None or p[0] <= end)]
    before = [p for p in pts if start and p[0] <= start]
    a = before[-1] if before else (inside[0] if inside else None)
    b = inside[-1] if inside else None
    pt = lambda p: {'at': p[0], 'value': p[1]} if p else None
    return pt(a), pt(b)


def loop_of(path):
    """1頁ぶん（読めなければ例外）"""
    d = load(path)
    bns = []
    for b in d.get('bottlenecks') or []:
        if isinstance(b, dict) and _str(b.get('from')) and _str(b.get('text')):
            bns.append({'from': b['from'].strip(), 'text': b['text'].strip()})
    bns.sort(key=lambda b: b['from'])
    hist = d.get('hist') or {}
    metric = d.get('metric') or {}
    pts = sorted((p['at'].strip(), p['value']) for p in hist.get('points') or []
                 if isinstance(p, dict) and _num(p.get('value')) is not None and _str(p.get('at')))
    last = {'at': pts[-1][0], 'value': pts[-1][1]} if pts else None
    for i, b in enumerate(bns):
        b['a'], b['b'] = span(pts, b['from'], bns[i + 1]['from'] if i + 1 < len(bns) else None)
    target, start = _num(hist.get('target')), _num(metric.get('start'))
    trials = []
    for r in d.get('records') or []:
        if isinstance(r, dict) and _str(r.get('id')):
            trials.append({'id': r['id'], 'date': _str(r.get('done')), 'short': _str(r.get('short')) or _str(r.get('title')) or r['id'],
                           'grade': _str(r.get('grade')) or '-', 'at': 'record'})
    for t in d.get('trials') or []:
        if isinstance(t, dict) and _str(t.get('id')):
            trials.append({'id': t['id'], 'date': _str(t.get('started')), 'short': _str(t.get('short')) or _str(t.get('title')) or t['id'],
                           'grade': '-', 'at': 'trial'})
    #=== 日付の順。日付の無いものは最後（いまの期間）
    trials.sort(key=lambda t: (t['date'] is None, t['date'] or '', t['id']))
    lid = _str(d.get('id')) or os.path.splitext(os.path.basename(path))[0]
    first = next((t['date'] for t in trials if t['date']), None)
    pa, pb = span(pts, first, None)
    return {
        'id': lid,
        'name': _str(d.get('short')) or _str(d.get('title')) or lid,
        'unit': _str(hist.get('unit')) or '',
        'lowerBetter': target is not None and start is not None and target < start,
        'now': last['value'] if last else None,
        'nowAt': last['at'] if last else None,
        'bottlenecks': bns,
        'period': None if bns else {'a': pa, 'b': pb},
        'trials': trials,
    }


def order_of(loops_dir):
    """殻の一覧の行の順（data-go="s-LXX"）"""
    try:
        html = open(os.path.join(loops_dir, 'index.html'), encoding='utf-8').read()
    except OSError:
        return []
    seen = []
    for m in re.finditer(r'data-go="s-(L[0-9A-Za-z_-]+)"', html):
        if m.group(1) not in seen:
            seen.append(m.group(1))
    return seen


def collect(loops_dir):
    pages = sorted(glob.glob(os.path.join(loops_dir, 'L*.html')))
    out, errors = [], []
    for p in pages:
        try:
            x = loop_of(p)
        except Exception as e:  # 読めない頁は飛ばして名前を出す（ほかの頁は出す）
            errors.append('%s: %s' % (os.path.basename(p), e))
            continue
        out.append(x)
    order = order_of(loops_dir)
    rank = {lid: i for i, lid in enumerate(order)}
    out.sort(key=lambda x: (rank.get(x['id'], len(order)), x['id']))
    return out, errors


def render(loops, generated):
    body = json.dumps({'generated': generated, 'loops': loops}, ensure_ascii=False, indent=1)
    return HEAD + 'window.HISTORY_DATA = ' + body + ';\n'


def _without_generated(text):
    return re.sub(r'"generated": "[^"]*"', '"generated": ""', text)


def main(argv):
    dry = '--dry-run' in argv
    here = os.path.dirname(os.path.abspath(__file__))
    loops_dir = os.path.dirname(here) if os.path.basename(here) == 'update' else os.path.join(os.getcwd(), 'loops')
    loops, errors = collect(loops_dir)
    for e in errors:
        print('  ⚠ 読めない頁（飛ばした）: ' + e)
    dest = os.path.join(loops_dir, 'history.js')
    text = render(loops, _dt.date.today().isoformat())
    try:
        old = open(dest, encoding='utf-8').read()
    except OSError:
        old = None
    if old is not None and _without_generated(old) == _without_generated(text):
        print('施策の流れ: 変わりなし（%d ループ）' % len(loops))
        return 0
    if dry:
        print('施策の流れ: %d ループを書く（--dry-run なので書いていない）' % len(loops))
        return 0
    tmp = dest + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(text)
    os.replace(tmp, dest)
    print('施策の流れ: %d ループを書いた → %s' % (len(loops), os.path.relpath(dest)))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
