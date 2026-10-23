/* ═══════════════════════════════════════════════════════════════
   rising.js — 殻（index.html）とループ頁（LXX.html）の共通 JS

   1本のファイルを両方が読む。先頭の IS_SHELL で、自分がどちらかを見分ける。
     殻   : #loop-frame を持つ → 画面の切り替え・何を聞くかと指示文の組み立て（入力の窓・右のチャットの窓・使い方はアプリが持つ）
     ループ頁 : 持たない       → ボタンを postMessage に変換・グラフの描画

   ★ このファイルは共通部品です。中身（ループ名・数字・パス）を書かないこと。
      値は殻の CONST ブロックと、頁の LOOP_DATA に置く。
   詳しくは ../references/HTML生成.md
   ═══════════════════════════════════════════════════════════════ */
var IS_SHELL = !!document.getElementById('loop-frame');

/* ───────── 共通 ───────── */
//=== 小数の目標（0.45円/人日 など）だと 0.26-0.28 が -0.020000000000000018 になる。
//=== 表示はここを通す。整数はそのまま（7 → "7"）、小数は2桁で丸める（0.02 → "0.02"）。
//=== 4桁以上は桁区切りを入れる（1000 → 1,000）。小数は2桁まで
function fmt(n){ return Number(+Number(n).toFixed(2)).toLocaleString('ja-JP', { maximumFractionDigits: 2 }); }

//=== 図の札（マウスを乗せる・触ると出る）。★札には、画面にまだ書いていない数字だけを出す。
//===   書いてある数字を繰り返すと、同じことを2回言うだけで何も足さない。
//===   部品は data-tip に札の文を置くだけ。出し方はここ1か所（文字は textContent。markup にしない）
var RL_TIP = (function(){
  //=== owner ＝ いま出している札の持ち主（data-tip の要素、または自分で札を出す図の箱）
  var el = null, owner = null;
  function show(text, x, y, from){
    if (!el){ el = document.createElement('div'); el.className = 'rl-tip'; document.body.appendChild(el); }
    owner = from || null;
    el.textContent = text;
    el.hidden = false;
    var w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = Math.max(4, Math.min(innerWidth - w - 4, x - w / 2)) + 'px';
    el.style.top = (y - h - 12 < 4 ? y + 18 : y - h - 12) + 'px';
  }
  function hide(){ if (el) el.hidden = true; owner = null; }
  //=== 触った場所が札を持っていれば出す。持ち主の外に出たら消す。
  //===   ★タッチでは pointermove が来ないので pointerdown でも拾う。
  //===   ★「札の無い所に乗ったら消す」では足りない。自分で札を出す図の上では消せず、
  //===     上のゲージの札が、下の棒グラフの上に残った（2026-10-16）。持ち主を覚えて、その外なら消す
  function pick(e){
    var t = e.target.closest && e.target.closest('[data-tip]');
    if (t) show(t.getAttribute('data-tip'), e.clientX, e.clientY, t);
    else if (owner && !(owner.contains && owner.contains(e.target))) hide();
  }
  document.addEventListener('pointermove', pick);
  document.addEventListener('pointerdown', pick);
  //=== ★一覧（殻）の札は、ループの頁（iframe）の上に移ると pointermove が来なくなる（動きは iframe の中に届く）。
  //===   iframe に入った瞬間の pointerover で拾って消す。一覧の札がループの頁の上に残った（2026-10-16）
  document.addEventListener('pointerover', pick);
  //=== 画面が動いた・窓の外へ出た・ほかの画面へ移った・描き直したときは、指している物が変わるので消す。
  //===   scroll は中の箱のスクロールも拾うよう capture で聞く
  document.addEventListener('scroll', hide, { capture: true, passive: true });
  addEventListener('wheel', hide, { passive: true });
  addEventListener('resize', hide);
  addEventListener('blur', hide);
  addEventListener('pagehide', hide);
  //=== 一覧からループの頁へ移る（殻の hash が変わる）ときも消す
  addEventListener('hashchange', hide);
  document.addEventListener('mouseleave', hide);
  document.addEventListener('visibilitychange', hide);
  return { show: show, hide: hide };
})();

//=== 押されたボタンから data-* を素で読む。殻でも頁でも同じものを取り、
//===   「どう組み立てるか」は殻の doAction だけが知っている（加工は殻に一本化）
//=== 施策の評価の各施策のボタン（.record-comment）なら、その施策名。ほかのボタンは null。
//===   ★頁の書き方が揺れても拾う（2.5.2）：data-sec の「」の中 → data-text → その施策の題（.record-item の h3。番号の札は除く）の順。
//===     data-sec="施策の評価" だけで施策名が data-text にある頁で、評価の窓ではなく「施策の評価エリアをカスタマイズ」が出ていた
function recName(el){
  if (!el.classList.contains('record-comment')) return null;
  var m = (el.getAttribute('data-sec') || '').match(/「(.+)」$/);
  if (m) return m[1];
  var t = (el.getAttribute('data-text') || '').trim();
  if (t) return t;
  var h = el.closest('.record-item') && el.closest('.record-item').querySelector('h3');
  if (!h) return '';
  var c = h.cloneNode(true);
  [].forEach.call(c.querySelectorAll('.tid-pill, button'), function(x){ x.remove(); });
  return c.textContent.trim();
}
function pickAction(target){
  var el;
  if ((el = target.closest('.add-loop')))  return { kind:'add-loop', d:{} };
  if ((el = target.closest('[data-upd]'))) return { kind:'upd',  d:{ upd: el.getAttribute('data-upd') } };
  //=== 施策を次の段へ移すボタン（2.5.8。頁を開いたときに下の「ボタンの呼び名と置き場所」が足す）
  if ((el = target.closest('.mv-do')))     return { kind:'mv-do',  d:{ id: el.getAttribute('data-id'), no: el.getAttribute('data-no'), text: el.getAttribute('data-text') } };
  if ((el = target.closest('.mv-ins')))    return { kind:'mv-ins', d:{ id: el.getAttribute('data-id'), text: el.getAttribute('data-text') } };
  if ((el = target.closest('.ins')))       return { kind:'ins',  d:{ id: el.getAttribute('data-id'), text: el.getAttribute('data-text') } };
  if ((el = target.closest('.do')))        return { kind:'do',   d:{ id: el.getAttribute('data-id'), no: el.getAttribute('data-no'), text: el.getAttribute('data-text') } };
  if ((el = target.closest('.cmt')))       return { kind:'cmt',  d:{ id: el.getAttribute('data-id'), loop: el.getAttribute('data-loop'), sec: el.getAttribute('data-sec'), rec: recName(el) } };
  if ((el = target.closest('[data-copy]')))return { kind:'copy', d:{ text: el.getAttribute('data-copy') } };
  //=== 施策の流れの札。そのループの頁を開いて、その施策の位置へ飛ぶ（data-go にしないのは、一覧の行の数え方とぶつけないため）
  if ((el = target.closest('[data-jump]')))return { kind:'go',   d:{ id: el.getAttribute('data-jump'), anchor: el.getAttribute('data-anchor') } };
  if ((el = target.closest('[data-go]')))  return { kind:'go',   d:{ id: el.getAttribute('data-go') } };
  return null;
}

/* ═══════════════════════════════════════════════════════════════
   殻（index.html）
   ═══════════════════════════════════════════════════════════════ */
if (IS_SHELL) (function(){
  var loopFrame = document.getElementById('loop-frame');

  /* ── 定数ブロック（index.html の CONST）から画面に埋める ── */
  //=== ★ベタ書きしない。ここが唯一の差し込み口
  var SERVICE = (typeof SERVICE_NAME === 'string' && SERVICE_NAME) ? SERVICE_NAME : '（サービス名）';
  //=== ★PANES は殻では使わない。アプリが読み、どの画面にチャットを付けるかを決める（右の窓はアプリが持つ）。
  //===   画面の切り替え（show）は一覧の行そのもの（[data-go]）を見る。二重管理にしない
  document.title = 'ライジング・ループ — ' + SERVICE;
  var listTitle = document.querySelector('#s-list h1.goal-name');
  if (listTitle) listTitle.textContent = SERVICE + 'ライジング・ループ';

  /* ── 指示文を送る・聞く（アプリとの約束） ── */
  //=== 指示文はアプリに直接渡す。アプリがいま見えている画面のチャットに貼って Enter まで押す
  //===   （右のチャットの窓もアプリが持つ。閉じていればアプリが開く）。クリップボードは使わない
  //=== 入力の窓もアプリが出す。殻が決めるのは「何を聞くか」（タイトル・説明・札）と、指示文の組み立てだけ（2.4.9 から窓の上の小見出し kick は使わない）
  //===   window.rlaApp.ask({ kick, title, sub, placeholder, chips, value }) → 入力された文（キャンセルなら null）。value は最初から入れておく文
  //===   window.rlaApp.send(指示文)
  var APP = window.rlaApp;
  function sendToApp(text){ if (APP) APP.send(text); }
  function askApp(cfg){
    if (!APP) return;
    APP.ask({ kick: cfg.kick, title: cfg.title, sub: cfg.sub || '', placeholder: cfg.ph, chips: cfg.chips || [], value: cfg.value || '' })
      .then(function(v){ v = String(v || '').trim(); if (v) sendToApp(cfg.compose(v)); });
  }

  /* ── 画面の切り替え ── */
  //=== 一覧は殻の中にある。ループは loop-frame に LXX.html を出す。
  //===   ★頁を替えるときは、loop-frame を新しく作り直す（src を付けてから差し込む）。
  //===     同じ iframe の中身を差し替えると、ブラウザの履歴が殻の hash と iframe の中身を一緒に覚え、
  //===     戻る・進むで iframe だけ昔の頁に戻されて hash とずれる（2.3.2 で直した。前は contentWindow.location.replace）。
  //===     差し込む前に src を付けた iframe の最初の読み込みは、履歴に積まれない
  //===     （差し込んだあとに src を付けると積まれる。Safari で実際に起きた）
  //===   ★履歴は殻の hash 代入だけ。同じ id なら再読込しない
  //=== loaded は「いま loop-frame に入っている頁」。一覧に戻っても忘れない
  //===   （忘れると L01 → 一覧 → L01 で読み直しになる）
  var listScreen = document.getElementById('s-list'), loaded = null;
  //=== 次に開く頁の中の飛び先（施策の流れの札から。#record-LXX-TYY / #trial-LXX-TYY）。show が1回使って消す
  var jumpTo = null;
  //=== 行けるのは「一覧」と「一覧に行がある画面」だけ。PANES は見ない（アプリのチャット専用）
  function knownId(id){ return id === 's-list' || !!document.querySelector('[data-go="' + id + '"]'); }
  function show(id){
    //=== 画面を替えたら、前の画面の札は消す（指している物がもう見えない）
    RL_TIP.hide();
    if (!knownId(id)){
      //=== 知らない #hash は一覧に丸める。hash も揃えないと戻る／再読込で同じ所に戻ってしまう
      id = 's-list';
      if (location.hash !== '#s-list') {
        location.replace(location.pathname + location.search + '#s-list');
        return;                                 //=== hashchange で show('s-list') が来る
      }
    }
    if (id === 's-list'){
      document.body.classList.remove('in-loop');
      if (listScreen) listScreen.classList.add('active');
    } else {
      if (listScreen) listScreen.classList.remove('active');
      document.body.classList.add('in-loop');
      var anchor = jumpTo; jumpTo = null;
      //=== 飛び先があるときは、同じ頁が読み込み済みでも作り直す（src の # で頁の中の位置まで送る）
      if (loaded !== id || anchor){
        //=== ★相対のまま渡すと、iframe の現在地（about:blank 等）を基準にされることがある。
        //===   殻の URL を基準に絶対化して渡す
        var nf = document.createElement('iframe');
        nf.id = 'loop-frame';
        nf.title = loopFrame.title;
        nf.src = new URL(id.replace('s-', '') + '.html' + (anchor ? '#' + anchor : ''), location.href).href;
        //=== 頁の図は読み込みのあとで高さが変わるので、読み終わったら合わせ直す（同じオリジンのときだけ。読めなければ # の位置のまま）
        if (anchor) nf.addEventListener('load', function(){
          try { var t = nf.contentDocument.getElementById(anchor); if (t) t.scrollIntoView({ block: 'start' }); } catch (err) {}
        });
        loopFrame.replaceWith(nf);
        loopFrame = nf;
        loaded = id;
      }
    }
    //=== ★幅が変わるので、殻に図があれば描き直す（いまは頁側が持っている）
    (window.LOOP_REDRAWS || []).forEach(function(f){ f(); });
  }

  /* ── 入力の窓のプレースホルダ ── */
  //=== セクションの［AIに指示］：見た目（要素・レイアウト）を直してもらう窓
  var PH_LAYOUT='〇〇の数字を入れて／〇〇のグラフを常に表示して／〇〇のエリアは削除して、など自由にどうぞ。';
  //=== 施策の評価の各施策の［AIに指示］
  var PH_REC='評価を見直して／判定を確定して（効いた・効かなかった）／この認識は違う／これは消して、など自由にどうぞ。';
  var PH_DO='これは消して／この認識は違う／別案にして、など自由にどうぞ。';
  //=== TRIAL にいる施策。もう TRIAL にいるので「移して」とは書かない（2.4.6）
  var PH_INS='次に進んで／TODOを見直したい／これは消して、など自由にどうぞ。';
  //=== 施策を次の段へ移すボタン（［↓ 実行へ移動］［↓ 評価へ移動］）で書き込む文。やることが決まっているので候補は出さない（2.5.8）
  var MOVE = { do: '施策を実行したい。TRIALに移動してTODOを見せて', ins: '完了にして評価に移動して' };

  /* ── 指示文の組み立て。殻に1つだけ置く（用途が増えても分岐が増えない） ── */
  //=== 送る文言は、チャットで読める形に固定する。
  //===   ★ target は「その項目についての指示」のときだけ出す。セクションへのコメントには出さない
  //===     （画面ぜんたいを見て言っているのに、勝手に対象を狭めないため）
  var SEC = { 'ゴール':'GOAL', 'ボトルネック':'BOTTLENECK', '施策の実行':'TRIAL',
              '施策の評価':'RECORD', 'ループ一覧':'LOOPS' };
  function kickOf(sec){
    for (var k in SEC) if (sec && sec.indexOf(k) === 0) return SEC[k];
    return sec || '';
  }
  function block(loop, sec, target, v, key){
    var s = '---\nloop: ' + (loop || '') + '\nsection: ' + sec + '\n';
    if (target) s += 'target: ' + target + '\n';
    s += 'rule: まず /rising-loop を呼び出して最新の手順を読み、それに従うこと\n' + (key || 'feedback') + ': |\n';
    s += String(v || '').split('\n').map(function(x){ return '  ' + x; }).join('\n');
    return s + '\n---';
  }
  //=== 更新ボタン。人の言葉ではなく命令なので task: にする
  //===   ★手順は書かない。rule: 行で SKILL.md の「数字を更新し、施策を再評価する」に乗る。
  //===   ここに写すと二重持ちになり、スキルを直したときにこちらが古いまま残る
  var TASK = { all: 'loops/ の全ループを更新して', one: 'このループを更新して' };

  //=== 殻の中のクリックも、ループ頁からの postMessage も、ここに集まる。
  //===   受け取るのは生の data-*（d）だけ。加工はここでしかしない
  function doAction(kind, d){
    d = d || {};
    if (kind === 'add-loop'){
      //=== 札は、このプロジェクトの候補（殻の CONST の LOOP_IDEAS。AI がループを作ったとき・全ループ更新のときに書く。2.4.8）。
      //===   まだ書かれていなければ、どのプロジェクトにも当てはまる汎用の例を出す
      var ideas = (typeof LOOP_IDEAS !== 'undefined' && LOOP_IDEAS && LOOP_IDEAS.length) ? LOOP_IDEAS
        : ['申し込みを増やしたい','見込み客を増やしたい','翌日また来る人を増やしたい','有料に切り替える人を増やしたい','解約を減らしたい','TOEIC の点を上げたい','YouTube の登録者を増やしたい','株の含み益を増やしたい','体重を落としたい','貯金を毎月積みたい'];
      askApp({ title:'ループを追加', sub:'どんな数字を上げたいですか。ひとことで', ph:'例: ' + ideas[0],
        chips: ideas.map(function(t){ t = String(t); return [t, t]; }),
        compose:function(v){ return block('', 'LOOPS', '', 'ループを追加して: ' + v, 'task'); } });
      return;
    }
    //=== 更新は1回押しただけでは送らない。更新の文を入れた入力の窓を開き、［送る］で送る（書き足してもよい）
    if (kind === 'upd'){
      var ul = d.upd, uall = ul === 'all';
      askApp({ title: uall ? '全ループを更新' : 'このループを更新', sub: uall ? '全ループを更新します' : 'このループを更新します',
        ph:'', value: uall ? TASK.all : TASK.one,
        compose:function(v){ return block(ul, uall ? 'ALL' : 'GOAL', '', v, 'task'); } });
      return;
    }
    if (kind === 'ins' || kind === 'mv-ins'){
      var iid = d.id, itx = d.text;
      //=== ［AIに指示］は候補つき。［↓ 評価へ移動］は文を書き込んで、候補は出さない
      askApp(kind === 'mv-ins'
        ? { title:'施策について', sub:itx, ph:'', value:MOVE.ins, chips:[], compose:function(v){ return block(iid, 'TRIAL', itx, v); } }
        : { title:'施策について', sub:itx, ph:PH_INS,
            chips:[['これは消して','これは消して'],['この認識は違う','この認識は違う'],['次に進んで','次に進んで'],['TODOを見直したい','TODOを見直したい']],
            compose:function(v){ return block(iid, 'TRIAL', itx, v); } });
      return;
    }
    if (kind === 'do' || kind === 'mv-do'){
      var did = d.id, dno = d.no, dtx = d.text;
      //=== ［AIに指示］は候補つき。［↓ 実行へ移動］は文を書き込んで、候補は出さない
      askApp(kind === 'mv-do'
        ? { title:'施策案 '+dno+'について', sub:dtx, ph:'', value:MOVE.do, chips:[], compose:function(v){ return block(did, 'BOTTLENECK', dtx, v); } }
        : { title:'施策案 '+dno+'について', sub:dtx, ph:PH_DO,
            chips:[['これは消して','これは消して'],['この認識は違う','この認識は違う'],['別案にして','別案にして']],
            compose:function(v){ return block(did, 'BOTTLENECK', dtx, v); } });
      return;
    }
    if (kind === 'cmt'){
      var cid = d.id, clp = d.loop, csec = d.sec;
      //=== 施策の評価の各施策のボタンなら、その施策名を target にする（名前の拾い方は recName）
      var rec = d.rec != null ? d.rec : ((csec || '').match(/「(.+)」$/) || [])[1];
      if (rec != null){
        askApp({ title:'評価中の施策について', sub:rec, ph:PH_REC,
          chips:[['評価を見直して','評価を見直して'],['判定を確定して','判定を確定して'],['この認識は違う','この認識は違う'],['これは消して','これは消して']],
          compose:function(v){ return block(cid, 'RECORD', rec, v); } });
      } else {
        //=== 一覧の［AIに指示］は、一覧の上の見出しの所（ヘッダセクション）にある
        //===   ★送るときの section は HEADER（LOOPS だとループ一覧の行が対象だと誤解される）
        var head = csec === 'ループ一覧';
        var area = (head ? 'ヘッダ' : csec) + 'エリア';
        askApp({ title:area+'をカスタマイズ', sub:area+'の要素やレイアウトをカスタマイズします。', ph:PH_LAYOUT,
          compose:function(v){ return block(cid, head ? 'HEADER' : kickOf(csec), '', v); } });
      }
      return;
    }
    //=== 💡 のコマンドなど、指示文でないものは普通のコピー
    if (kind === 'copy'){ if (navigator.clipboard) navigator.clipboard.writeText(d.text).catch(function(){}); return; }
    if (kind === 'go'){ jumpTo = d.anchor || null; location.hash = d.id; return; }
  }

  document.addEventListener('click', function(e){
    var a = pickAction(e.target);
    if (!a) return;
    e.preventDefault(); e.stopPropagation();
    doAction(a.kind, a.d);
  });

  /* ── ループ頁からのメッセージ ── */
  //=== ★ targetOrigin は '*'（Safari は file:// を毎回別のオリジンにする）。
  //===   送信元は event.source で見る。event.origin は見ない
  window.addEventListener('message', function(e){
    if (!loopFrame.contentWindow || e.source !== loopFrame.contentWindow) return;
    var m = e.data || {};
    if (m.t === 'go')   { doAction('go', { id: m.id }); return; }
    if (m.t === 'copy' || m.t === 'modal') { doAction(m.kind, m.d); return; }
  });

  /* ── AI 作業中の札（アプリとの約束。2.4.0 から） ── */
  //=== アプリが window.LOOP_SET_BUSY(['s-list','s-L01', …]) で、チャットの AI が作業中の画面を知らせる（作業が終われば外れる）。
  //===   殻は一覧のその行の右上の角に「AI作業中」の札を重ねて出す。s-list（一覧のチャット）は一覧の見出しの枠の右上の角に出す。
  //===   重ねて出すので、札があってもなくても行の中身の位置は動かない（札の置き場は position:relative の .ai-busy-host）
  //===   一覧の行の markup は AI が書くので、決め打ちしない（行は [data-go]、見出しの枠は一覧の最初の .section）
  function busyPill(){ var p = document.createElement('span'); p.className = 'ai-busy-pill'; p.textContent = 'AI作業中'; return p; }
  window.LOOP_SET_BUSY = function(ids){
    var on = {}; (Array.isArray(ids) ? ids : []).forEach(function(id){ on[String(id)] = true; });
    Array.prototype.forEach.call(document.querySelectorAll('.ai-busy-pill'), function(p){ p.parentNode.removeChild(p); });
    function put(host){ host.classList.add('ai-busy-host'); host.appendChild(busyPill()); }
    Array.prototype.forEach.call(document.querySelectorAll('#s-list [data-go]'), function(row){
      var busy = !!on[row.getAttribute('data-go')];
      row.classList.toggle('ai-busy', busy);
      if (busy) put(row);
    });
    var head = document.querySelector('#s-list .section');
    if (head && on['s-list']) put(head);
  };

  /* ── 施策の流れ（HISTORY。2.5.0、描き方は 2.5.1） ── */
  //=== loops/history.js（loops/update/history.py が全頁の LOOP_DATA から書く）の HISTORY_DATA から、一覧のループ一覧の下に描く。無ければ出さない。
  //===   どのループも同じ決まりで、上から下へ：ボトルネックの箱 → その期間の施策の札 → 矢印 → 次の箱 … → 「現在」の箱で締める。
  //===   施策は日付で、ボトルネックの期間（from から次の from の前日まで）に振り分ける。最初の from より前は最初の期間、日付の無いものは最後。
  //===   箱の右は、その期間の終わりの数字（history.py が計測の記録 hist.points から拾った点）と、始まりより良くなったか（緑の↗・赤の↘）。
  //===   左の数字は上の箱の右と同じなので出さない。点が1つだけならその数字、無ければ「計測前」。
  //===   ボトルネックの記録が無いループも落とさず、記録なしの箱1つにまとめる。施策がまだ1つも無いループは「まだ施策がありません」だけ。
  //===   強調するのは施策（札は太字）。ボトルネックの文は小さく。札を押すと、その頁のその施策の位置へ飛ぶ。
  //===   ★見出しの貼り付け（下の markStuck）が見出しを集める前に差し込む
  (function(){
    var D = window.HISTORY_DATA;
    var host = document.querySelector('#s-list .flow .section.t-loops');
    if (!host || !D || !D.loops || !D.loops.length) return;
    function esc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]; }); }
    function md(d){ var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); return m ? (+m[2]) + '/' + (+m[3]) : ''; }
    function fmt(v){ return v.toLocaleString('ja-JP', { maximumFractionDigits: 2 }); }
    function pt(p){ return p && typeof p.value === 'number' ? p : null; }
    var UP = '<svg class="tr up" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><path d="M3 11L11 3M5 3h6v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var DN = '<svg class="tr dn" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><path d="M3 3l8 8M11 5v6H5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    //=== 期間の数字。a・b は計測の点（{ at, value }）。両方あって日が違えば「向き＋終わりの数字」と期間、1つならその数字と日、無ければ計測前
    function num(a, b, unit, lower){
      a = pt(a); b = pt(b);
      if (!a && !b) return '<span class="hs-num off">計測前</span>';
      if (!a || !b || a.at === b.at){ var p = b || a; return '<span class="hs-num"><b>' + fmt(p.value) + '</b><small>' + esc(unit) + ' ・ ' + md(p.at) + '</small></span>'; }
      var better = lower ? b.value < a.value : b.value > a.value;
      var cls = a.value === b.value ? '' : (better ? 'up' : 'dn');
      var mark = a.value === b.value ? '→ ' : (better ? UP : DN);
      return '<span class="hs-num">' + mark + '<b class="' + cls + '">' + fmt(b.value) + '</b><small>' + esc(unit) + ' ・ ' + md(a.at) + '〜' + md(b.at) + '</small></span>';
    }
    function jump(L, t){ return ' data-jump="s-' + esc(L.id) + '" data-anchor="' + (t.at === 'trial' ? 'trial-' : 'record-') + esc(L.id) + '-' + esc(t.id) + '"'; }
    function tag(L, t){
      var g = String(t.grade || '-').toUpperCase(), cls = /^[A-E]$/.test(g) ? 'g-' + g.toLowerCase() : 'g-n';
      return '<span class="hs-tp ' + cls + '" data-g="' + (cls === 'g-n' ? '-' : g) + '"' + jump(L, t) + ' title="この施策を開く"><span class="hs-d">' + md(t.date) + '</span>' + esc(t.short) + '</span>';
    }
    function head(L){ return '<div class="hs-loop"><div class="hs-h"><span class="hs-lp">' + esc(L.id) + '</span>' + esc(L.name) + '</div>'; }
    var cols = D.loops.map(function(L){
      if (!(L.trials || []).length) return head(L) + '<div class="hs-blank">まだ施策がありません</div></div>';
      var bns = (L.bottlenecks || []).slice().sort(function(a, b){ return a.from < b.from ? -1 : a.from > b.from ? 1 : 0; });
      var none = !bns.length;
      if (none) bns = [{ from: '', text: 'ボトルネックの記録がありません', a: L.period && L.period.a, b: L.period && L.period.b }];
      var last = bns.length - 1, gaps = bns.map(function(){ return []; });
      (L.trials || []).forEach(function(t){
        var at = t.date ? 0 : last;
        if (t.date) for (var i = 0; i < bns.length; i++) if (bns[i].from <= t.date) at = i;
        gaps[at].push(t);
      });
      var h = head(L);
      bns.forEach(function(b, i){
        h += '<div class="hs-bn' + (none ? ' none' : '') + '"><span>' + esc(b.text) + '</span>' + num(b.a, b.b, L.unit, L.lowerBetter) + '</div>';
        h += '<div class="hs-ts' + (gaps[i].length ? '' : ' hs-gap') + '">' + gaps[i].map(function(t){ return tag(L, t); }).join('') + '</div>';
      });
      var now = typeof L.now === 'number' ? { at: L.nowAt, value: L.now } : null;
      return h + '<div class="hs-bn hs-cur"><span>現在</span>' + num(now, now, L.unit, L.lowerBetter) + '</div></div>';
    }).join('');
    if (!cols) return;
    var sec = document.createElement('div');
    sec.className = 'section tabbed t-history hist-sec';
    sec.innerHTML = '<div class="sec-tab t-history"><span class="k">HISTORY</span><span class="ja">施策の流れ</span></div>'
      + '<div class="hs-legend"><span class="hs-tp g-a" data-g="A・B">狙いに届いた</span><span class="hs-tp g-c" data-g="C">半分</span><span class="hs-tp g-d" data-g="D・E">届かなかった</span><span class="hs-tp g-n" data-g="-">まだ（いまやっている）</span></div>'
      + '<div class="hs-cols">' + cols + '</div>';
    host.insertAdjacentElement('afterend', sec);
  })();

  /* ── hash ── */
  window.addEventListener('hashchange', function(){
    show(location.hash.replace('#','') || 's-list');
  });

  //=== 最初の1回。hashchange は飛ばないので直に呼ぶ
  show(location.hash.replace('#','') || 's-list');
})();

/* ═══════════════════════════════════════════════════════════════
   ループ頁（LXX.html）
   ═══════════════════════════════════════════════════════════════ */
if (!IS_SHELL) (function(){
  var screen = document.querySelector('.screen');
  if (screen) screen.classList.add('active');   //=== 頁には1枚しか無いので必ず出す
  var STANDALONE = (window.parent === window);

  //=== 単体で開かれたとき。壊れないことだけ保証する（トーストもモーダルも殻にある）
  if (STANDALONE){
    var note = document.createElement('div');
    note.className = 'standalone-note';
    note.innerHTML = 'この頁は <a href="index.html">index.html</a> から開いてください。'
                   + '（単体で開いているので、ボタンは押しても何も起きません）';
    document.body.insertBefore(note, document.body.firstChild);
  }

  /* ── ボタンは「押されたら殻に頼む」だけ。生の data-* をそのまま送る ── */
  //=== ★ targetOrigin は '*' 一択。Safari は file:// を毎回別のオリジンにする
  function send(m){ window.parent.postMessage(m, '*'); }
  document.addEventListener('click', function(e){
    var a = pickAction(e.target);
    if (!a) return;
    e.preventDefault(); e.stopPropagation();
    if (STANDALONE) return;                     //=== 単体表示では何もしない
    if (a.kind === 'go')   { send({ t:'go', id: a.d.id }); return; }
    if (a.kind === 'upd' || a.kind === 'copy'){ send({ t:'copy', kind:a.kind, d:a.d }); return; }
    send({ t:'modal', kind:a.kind, d:a.d });    //=== add-loop / ins / do / cmt
  });

  /* ── グラフ。この頁のぶんだけ（LOOP_DATA.hist / LOOP_DATA.funnel） ── */
  var DATA = (typeof LOOP_DATA !== 'undefined' && LOOP_DATA) ? LOOP_DATA : {};

  /* ── GOAL の履歴（折れ線＋棒） ── */
  (function(){
    //=== 折れ線。ファネルと同じく D3 で描く（描画の仕方をこのファイルで1通りに揃えている）。
    //===   ★実寸で描くので viewBox の引き伸ばしをしない。丸が楕円に歪まず、目標ラベルも SVG に置ける。
    //===   D3 が読めなかったときは何も描かない（数字は上のゲージと記録に出ている）。
    function drawChart(el, pts, target, unit, cur, days, dayUnit, dayTarget, dayTargetUnit, line, tlabel, opt){
      //=== ★幅を先に見る。幅ゼロ（非表示中）で消すと、描き直しが来るまで図が空になる。
      //===   drawFunnel と同じ順（見られる状態か確かめてから消す）
      var W = el.clientWidth;
      if (!W || !window.d3) return;
      el.innerHTML = '';
      var H = 96, PAD = 10, PAD_R = 78;                       //=== 右は「目標」ラベルのぶん空ける
      //=== 日ごとの数字を持っているループは、棒＋折れ線で描く（下の drawBars）。
      //===   持っていないループはこれまでどおり折れ線だけ。
      if (days && days.length) return drawBars(el, pts, cur, days, W, dayUnit, dayTarget, dayTargetUnit, unit, line, opt || {});
      var vals = pts.map(function(p){ return p.value; }).concat([target, 0]);
      var y = d3.scaleLinear()
        .domain([d3.min(vals), d3.max(vals)])
        .range([H - PAD, PAD]);
      var x = d3.scaleLinear()
        .domain([0, Math.max(1, pts.length - 1)])
        .range([PAD, pts.length < 2 ? W / 2 : W - PAD_R]);

      var svg = d3.select(el).append('svg').attr('width', W).attr('height', H);
      drawTarget(svg, W, PAD_R, y(target), target, unit, tlabel);

      if (pts.length > 1) {
        svg.append('path')
          .attr('fill', 'none').attr('stroke', '#52751f').attr('stroke-width', 2)
          .attr('d', d3.line().x(function(p, i){ return x(i); }).y(function(p){ return y(p.value); })(pts));
      }
      svg.selectAll('circle').data(pts).enter().append('circle')
        .attr('cx', function(p, i){ return x(i); })
        .attr('cy', function(p){ return y(p.value); })
        .attr('r', function(p, i){ return i === cur ? 5 : 3.5; })
        .attr('fill', function(p, i){ return i === cur ? '#52751f' : '#a8b3a4'; });

      //=== 触ると: いちばん近い日に縦の線を引き、その点に「日付 値」を添える。
      //===   ★小さい丸に当てさせない。グラフのどこに乗せても、横の位置でいちばん近い点に吸い付く
      //===   （折れ線には日付の目盛りも値も書いていないので、札は日付と値の2つ）
      var hv = hoverLayer(svg, PAD - 4, H - PAD + 4);
      overlay(svg, W, H, function(mx){
        var i = Math.max(0, Math.min(pts.length - 1, Math.round(x.invert(mx))));
        var p = pts[i];
        hv.at(x(i), y(p.value), String(p.label || '').replace('月', '/').replace('日', '') + '  ' + fmt(p.value) + unit, W);
      }, hv.off);
    }

    //=== 触ったときの縦の線・丸・札（折れ線と棒＋線で共通）。札は SVG の文字で、点のすぐ上に直に書く
    function hoverLayer(svg, y1, y2, noLine){
      var g = svg.append('g').style('pointer-events', 'none').attr('display', 'none');
      //=== 棒＋線は日の帯を敷くので縦の線は引かない
      var gl = g.append('line').attr('y1', y1).attr('y2', y2).attr('stroke', '#87918b').attr('stroke-dasharray', '2 3').attr('display', noLine ? 'none' : null);
      var gc = g.append('circle').attr('r', 5.5).attr('fill', '#52751f').attr('stroke', '#fff').attr('stroke-width', 2);
      var gt = g.append('text').attr('font-size', 12).attr('font-weight', 700).attr('fill', '#1c2821')
        .attr('font-family', 'ui-monospace,SFMono-Regular,Menlo,monospace')
        .attr('stroke', '#fffefb').attr('stroke-width', 4).attr('paint-order', 'stroke');
      return {
        at: function(cx, cy, text, W){
          g.attr('display', null);
          gl.attr('x1', cx).attr('x2', cx);
          gc.attr('cx', cx).attr('cy', cy).attr('display', cy == null ? 'none' : null);
          //=== 右寄りの点は左へ、左寄りの点は右へ札を出す（枠の外に出さない）
          var anc = cx > W * 0.7 ? 'end' : cx < W * 0.15 ? 'start' : 'middle';
          gt.attr('display', text ? null : 'none').text(text || '')
            .attr('text-anchor', anc).attr('x', cx + (anc === 'end' ? -9 : anc === 'start' ? 9 : 0))
            .attr('y', Math.max(13, (cy == null ? y1 : cy) - 11));
        },
        off: function(){ g.attr('display', 'none'); }
      };
    }
    //=== 図の全面に透明な板を敷いて、横の位置を渡す。★タッチは指を離しても消さない（離した瞬間に消えると読めない）
    var rawEv = null;
    function overlay(svg, W, H, onX, onOff){
      svg.append('rect').attr('width', W).attr('height', H).attr('fill', 'transparent')
        .on('pointermove pointerdown', function(ev){ rawEv = ev; onX(d3.pointer(ev)[0]); })
        .on('pointerleave', function(ev){ if (ev.pointerType !== 'touch') onOff(); });
    }

    //=== 目標の破線と、その正体を書くラベル（折れ線だけの図。棒＋線は目標を描かない）
    //===   ★下げたいループ（コストなど）は LOOP_DATA.hist に targetLabel: '上限' を置く。既定は「目標」
    function drawTarget(svg, W, PAD_R, ty, target, unit, tlabel){
      svg.append('line').attr('x1', 0).attr('x2', W - PAD_R + 6)
        .attr('y1', ty).attr('y2', ty)
        .attr('stroke', '#cbd2cb').attr('stroke-dasharray', '4 4').attr('stroke-width', 1);
      svg.append('text').attr('x', W).attr('y', ty + 4).attr('text-anchor', 'end')
        .attr('font-family', 'ui-monospace,SFMono-Regular,Menlo,monospace')
        .attr('font-size', 12).attr('fill', '#87918b')
        .text((tlabel || '目標') + ' ' + fmt(target) + unit);
    }

    //=== 棒＝その日の数字 ／ 折れ線＝計測点（その窓の最終日の位置に置く）。
    //===   ★折れ線だけだと 44→37→37→39 が 0〜60 の縦軸の中で潰れて水平線に見える。
    //===     棒を下敷きにすると 0 からの高さが出て、日ごとの動きも同じ絵で読める。
    //=== ★棒が「1日ぶんの実額」で、ゴールが月額のときは、折れ線も1日ぶんに直す
    //===   （各点の dayValue。単位は dayTargetUnit）。棒だけ月換算にすると「6470円」のような
    //===   実在しない額が並んで読めなくなる（2026-09-05 のフィードバック）。
    //=== ★分母つきの棒（days[].of）。その日に「できた数」の棒を、「機会の数」の薄い棒の中に重ね、上に「できた/機会」を書く。
    //===   例: 払った/決済シートが出た、コンバージョン/クリック。2つのループが別々に頁の中で同じ絵を描いていたので部品にした。
    //===   of・n は件数。v が件数でないループ（金額など）は、できた件数を n に置く。v は札に回す（単位は dayUnit）。
    //===   ★1件の額で割って件数を出さない。額は券ごとに違う（L01 は 9/13 から3日券・30日券が混ざる）
    function drawBars(el, pts, cur, days, W, dayUnit, dayTarget, dayTargetUnit, unit, line, opt){
      //=== 目標は図に描かない（下の ★いつも2軸）。単位だけ1日ぶんに合わせる
      if (dayTarget != null) unit = dayTargetUnit || unit;
      var OF = days.some(function(d){ return d.of != null; });
      //=== 分母つきのとき、棒の高さは件数（n。無ければ v）。分母つきでないときは v
      var cnt = function(d){ return OF && d.n != null ? d.n : d.v; };
      var top2 = function(d){ return Math.max(cnt(d), d.of || 0); };
      //=== 日付の下の施策の印（2.5.16）。同じ日の施策は縦に積むので、その段の数だけ下を空ける
      var marks = chartMarks(days);
      var under = marks.length ? d3.max(marks, function(m){ return m.list.length; }) * 17 + 4 : 0;
      var H = 190 + under, PAD_T = 18, PAD_B = 22 + under, PAD_L = 4, PAD_R = 8;
      //=== ★30日ぶんまで並べる（2.5.16）。1日の幅が DAY_W を切るなら、図を広げて横にスクロールさせる。
      //===   幅に詰め込むと、日が増えるほど棒も数字も細って読めなくなる。開いたときは右端（いちばん新しい日）を見せる
      var DAY_W = 46;
      W = Math.max(W, PAD_L + PAD_R + days.length * DAY_W);
      var esc = function(t){ return String(t == null ? '' : t).replace(/[&<>"]/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]; }); };
      if (OF && (opt.ofLabel || opt.vLabel))
        el.insertAdjacentHTML('beforeend', '<div class="rl-key"><span><i class="of"></i>' + esc(opt.ofLabel || '') + '</span>'
          + '<span><i style="background:#c3d29b"></i>' + esc(opt.vLabel || '') + '（数字は ' + esc(opt.vLabel || '') + '/' + esc(opt.ofLabel || '') + '）</span></div>');
      var scroller = el.appendChild(document.createElement('div'));
      scroller.className = 'rl-scroll';
      var inner = scroller.appendChild(document.createElement('div'));
      inner.className = 'rl-inner';
      inner.style.width = W + 'px';
      var svg = d3.select(inner).append('svg').attr('width', W).attr('height', H);
      //=== ★いつも2軸（2026-10-16 から。dualAxis は見ない）。線は上の帯、棒は下の帯に分け、縦軸もそれぞれに取る。
      //===   1本の縦軸にすると、単位の違う2つ（線は %・棒は人）を同じ目盛りに載せることになり、
      //===   目標がはるか上にあれば棒も線もぺたんこになる（2026-09-05）。同じ高さを通ると棒の数字が線に隠れる（L01）。
      //===   目標までの距離は上のゲージが見せているので、図に目標の線は引かない
      var yBar = d3.scaleLinear()
        .domain([0, d3.max(days.map(top2)) || 1])
        .range([H - PAD_B, PAD_T + 84]);
      //=== ★線の縦軸は「実際に描く系列」から取る。line を持つループで pts から取ると、
      //===   計測点が1つしか無いとき domain が潰れて、線がグラフの外へ飛ぶ（2026-09-14）
      var inWin = {}; days.forEach(function(q){ inWin[q.d] = 1; });
      var lvals = (line && line.length)
        ? line.filter(function(q){ return inWin[q.d]; }).map(function(q){ return q.v; })
        : pts.map(function(p){ return p.dayValue != null ? p.dayValue : p.value; });
      var lo = d3.min(lvals), hi = d3.max(lvals), lastLabel = null;
      var yLine = d3.scaleLinear().domain([lo, hi > lo ? hi : lo + 1]).range([PAD_T + 56, PAD_T + 4]);
      var x = d3.scaleBand().domain(days.map(function(d){ return d.d; }))
        .range([PAD_L, W - PAD_R]).padding(0.34);

      //=== 小数の混ざる系列（0.10円）は桁を揃える。fmt だと 0.10 が "0.1" になって並びが乱れる
      var frac = days.some(function(d){ return d.v % 1 !== 0; });
      var dfmt = function(v){ return frac ? v.toFixed(2) : String(v); };

      //=== 触った日の帯（棒の後ろに敷く）
      var band = svg.append('rect').attr('y', PAD_T - 6).attr('height', H - PAD_B - PAD_T + 6)
        .attr('width', x.step()).attr('fill', '#eef2e6').attr('display', 'none');
      //=== 分母の薄い棒（of のある日だけ）。できた数の棒は、その内側に少し細く重ねる
      svg.selectAll('rect.of').data(days.filter(function(d){ return d.of != null; })).enter().append('rect').attr('class', 'of')
        .attr('x', function(d){ return x(d.d); }).attr('width', x.bandwidth())
        .attr('y', function(d){ return yBar(d.of); })
        .attr('height', function(d){ return Math.max(0, yBar(0) - yBar(d.of)); })
        .attr('fill', '#f6f8f1').attr('stroke', '#c9d3b6');
      var inset = function(d){ return d.of != null ? Math.min(3, x.bandwidth() * 0.2) : 0; };
      svg.selectAll('rect.bar').data(days).enter().append('rect').attr('class', 'bar')
        .attr('x', function(d){ return x(d.d) + inset(d); }).attr('width', function(d){ return Math.max(0, x.bandwidth() - inset(d) * 2); })
        .attr('y', function(d){ return yBar(cnt(d)); })
        .attr('height', function(d){ return Math.max(0, yBar(0) - yBar(cnt(d))); })
        //=== 途中の日（partial）は薄くするだけ。印や注記は付けない（毎日見る人には分かる）
        .attr('fill', function(d){ return d.partial && d.of == null ? '#e1e9cf' : '#c3d29b'; });
      //=== 分母つきの日は、薄い棒の上に「できた/機会」。できた日は濃く、0 の日は薄く
      svg.selectAll('text.bf').data(days.filter(function(d){ return d.of != null; })).enter().append('text').attr('class', 'bf')
        .attr('x', function(d){ return x(d.d) + x.bandwidth() / 2; }).attr('y', function(d){ return yBar(top2(d)) - 5; })
        .attr('text-anchor', 'middle').attr('font-size', 11)
        .attr('font-weight', function(d){ return d.v > 0 ? 700 : 400; })
        .attr('fill', function(d){ return d.v > 0 ? '#4c5b3c' : '#a8b3a4'; })
        .attr('font-family', 'ui-monospace,SFMono-Regular,Menlo,monospace')
        .text(function(d){ return fmt(cnt(d)) + '/' + fmt(d.of); });
      svg.selectAll('text.bv').data(days.filter(function(d){ return d.of == null; })).enter().append('text').attr('class', 'bv')
        .attr('x', function(d){ return x(d.d) + x.bandwidth() / 2; })
        //=== 棒の上に置く（線は上の帯にあるので、ぶつからない）
        .attr('y', function(d){ return yBar(cnt(d)) - 5; })
        .attr('text-anchor', 'middle').attr('font-size', 11)
        .attr('fill', function(d){ return d.v > 0 ? '#4c5b3c' : '#a8b3a4'; })
        .attr('font-family', 'ui-monospace,SFMono-Regular,Menlo,monospace')
        .text(function(d){ return dfmt(d.v) + (dayUnit || ''); });

      //=== 計測点。棒に無い日（＝この窓より後の計測）は描かない
      //=== 同じ窓を取り直した点は同じ日に重なり、線が縦になる。選んでいる点を優先し、
      //===   それ以外は新しいほうだけを描く（2026-09-08 のフィードバック）。
      //=== 折れ線は「その日に計測していたらいくつだったか」を日ごとに描く（LOOP_DATA.hist の line）。
      //===   ★単位はゴールの単位のまま。line を持たないループは計測点をつなぐ。
      var seen = [];
      if (line && line.length) {
        line.forEach(function(q){
          var b = x(q.d);
          if (b === undefined) return;
          seen.push({ d: q.d, v: q.v, cur: false, cx: b + x.bandwidth() / 2 });
        });
        if (seen.length) seen[seen.length - 1].cur = true;
      } else {
        var byEnd = {};
        pts.forEach(function(p, i){
          var b = x(p.end);
          if (b === undefined) return;
          var s = { d: p.end, v: p.dayValue != null ? p.dayValue : p.value, cur: i === cur, cx: b + x.bandwidth() / 2 };
          if (byEnd[p.end] != null) {
            if (seen[byEnd[p.end]].cur) return;
            seen[byEnd[p.end]] = s;
          } else { byEnd[p.end] = seen.length; seen.push(s); }
        });
      }
      if (seen.length > 1) {
        svg.append('path').attr('fill', 'none').attr('stroke', '#52751f').attr('stroke-width', 2)
          .attr('d', d3.line().x(function(s){ return s.cx; }).y(function(s){ return yLine(s.v); })(seen));
      }
      svg.selectAll('circle').data(seen).enter().append('circle')
        .attr('cx', function(s){ return s.cx; }).attr('cy', function(s){ return yLine(s.v); })
        .attr('r', function(s){ return s.cur ? 5 : 3.5; })
        .attr('fill', function(s){ return s.cur ? '#52751f' : '#a8b3a4'; });

      //=== 軸が2本あるので、線の高さは目盛りでは読めない。最新の点に数字を添える。
      //===   ★「合計」は付けない。線が合計とは限らない（1人あたり・率のループもある）
      if (seen.length) {
        var last = seen[seen.length - 1];
        lastLabel = svg.append('text').attr('x', last.cx - 8).attr('y', yLine(last.v) - 9)
          .attr('text-anchor', 'end').attr('font-size', 11).attr('fill', '#4c5b3c')
          .attr('font-family', 'ui-monospace,SFMono-Regular,Menlo,monospace')
          .text(fmt(last.v) + (unit || ''));
      }
      svg.selectAll('text.xl').data(days).enter().append('text').attr('class', 'xl')
        .attr('x', function(d){ return x(d.d) + x.bandwidth() / 2; }).attr('y', H - 6 - under)
        .attr('text-anchor', 'middle').attr('font-size', 11).attr('fill', '#87918b')
        .attr('font-family', 'ui-monospace,SFMono-Regular,Menlo,monospace')
        .text(function(d){ return d.d; });
      drawMarks(el, inner, scroller, marks, function(d){ return x(d) + x.bandwidth() / 2; }, H - under + 2);

      //=== 触ると: その日の帯を敷き、線の点に値を添える。
      //===   ★棒の値と日付はもう書いてあるので、札は線の値だけ。
      //===     その日に線の点が無ければ、帯だけ（足す数字が無い）
      var hv = hoverLayer(svg, PAD_T - 6, H - PAD_B, true);
      overlay(svg, W, H, function(mx){
        var i = Math.max(0, Math.min(days.length - 1, Math.floor((mx - PAD_L) / x.step())));
        var dd = days[i], s = null;
        seen.forEach(function(q){ if (q.d === dd.d) s = q; });
        band.attr('display', null).attr('x', x(dd.d) - x.step() * x.padding() / 2);
        if (lastLabel) lastLabel.attr('display', 'none');
        if (s) hv.at(s.cx, yLine(s.v), fmt(s.v) + (unit || ''), W);
        else hv.off();
        //=== 分母つきの日は、札に割合（と、棒が金額なら金額）。「できた/機会」の数は棒の上に書いてある
        if (dd.of != null && rawEv){
          var r = dd.of ? Math.round(cnt(dd) / dd.of * 100) + '%' : '—';
          //=== n があるときの v（金額など）は、棒の上に書いていないので札に足す
          RL_TIP.show(r + (dd.n != null ? '・' + fmt(dd.v) + (dayUnit || '') : ''), rawEv.clientX, rawEv.clientY, el);
        } else RL_TIP.hide();
      }, function(){ band.attr('display', 'none'); hv.off(); RL_TIP.hide(); if (lastLabel) lastLabel.attr('display', null); });
      scroller.scrollLeft = scroller.scrollWidth;
    }

    //=== 施策の印に使う日付の形。"2026-09-07"・"9/7"・"9/07" をどれも "9/7" にそろえる
    function mdKey(s){ var m = String(s || '').match(/(\d{1,2})[\/-](\d{1,2})$/); return m ? (+m[1]) + '/' + (+m[2]) : null; }
    //=== 図に並べた日のうち、施策を入れた日（records[].done・trials[].started）と、その日の施策。古い日から
    //===   ★施策の流れ（history.py）と同じ値を読む。印のためにデータを足さない
    function chartMarks(days){
      var at = {}, by = {}, seen = {};
      days.forEach(function(d){ var k = mdKey(d.d); if (k) at[k] = d.d; });
      //=== ★評価に移した施策が trials[] にも残っていることがある（実際のループで T02 が2つ並んだ）。
      //===   records を先に読み、同じ id の trials は出さない（評価の色を持つほうを残す）
      function add(t, kind, date, g){
        var d = at[mdKey(date)];
        if (!t || !t.id || seen[t.id]) return;
        seen[t.id] = 1;
        if (!d) return;
        (by[d] = by[d] || []).push({ id: t.id, kind: kind, date: date, short: t.short || t.title || '', g: String(g || '-').toUpperCase() });
      }
      (DATA.records || []).forEach(function(r){ add(r, 'record', r.done, r.grade); });
      (DATA.trials || []).forEach(function(t){ add(t, 'trial', t.started, '-'); });
      return days.filter(function(d){ return by[d.d]; }).map(function(d){
        return { d: d.d, list: by[d.d].sort(function(a, b){ return a.id < b.id ? -1 : 1; }) };
      });
    }
    //=== 日付の下に施策の ID（T01 など）を小さく置く。乗せると、施策の流れと同じ札が真上に出る。
    //===   札か ID を押すと、この頁のその施策（#record-LXX-TYY / #trial-LXX-TYY）へ。
    //===   ★指では乗せられないので、1回目は札を出すだけ、札（または同じ ID）をもう1回押すと飛ぶ
    function drawMarks(el, inner, scroller, marks, cx, top){
      if (!marks.length) return;
      var pop = el.appendChild(document.createElement('div'));
      pop.className = 'rl-pop'; pop.hidden = true;
      var on = null, timer = null;
      function off(){ clearTimeout(timer); pop.hidden = true; if (on) on.classList.remove('on'); on = null; }
      //=== ID から札へマウスを渡すあいだに消えないよう、少し待ってから消す
      function later(){ clearTimeout(timer); timer = setTimeout(off, 160); }
      function anchor(m){ return m.kind + '-' + DATA.id + '-' + m.id; }
      function cls(m){ return /^[A-E]$/.test(m.g) ? 'g-' + m.g.toLowerCase() : 'g-n'; }
      function go(m){ off(); var t = document.getElementById(anchor(m)); if (t) t.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
      function show(a, m){
        clearTimeout(timer);
        if (on) on.classList.remove('on');
        on = a; a.classList.add('on');
        pop.innerHTML = '';
        var c = pop.appendChild(document.createElement('a'));
        c.className = 'rl-mark ' + cls(m); c.href = '#' + anchor(m); c.title = 'この施策を開く';
        c.setAttribute('data-g', m.g);
        c.appendChild(document.createElement('span')).className = 'hs-d';
        c.firstChild.textContent = mdKey(m.date);
        c.appendChild(document.createTextNode(m.short));
        c.addEventListener('click', function(e){ e.preventDefault(); go(m); });
        pop.hidden = false;
        var er = el.getBoundingClientRect(), ar = a.getBoundingClientRect();
        var left = ar.left + ar.width / 2 - er.left - pop.offsetWidth / 2;
        pop.style.left = Math.max(0, Math.min(el.clientWidth - pop.offsetWidth, left)) + 'px';
        pop.style.top = (ar.top - er.top - pop.offsetHeight - 6) + 'px';
      }
      pop.addEventListener('pointerenter', function(){ clearTimeout(timer); });
      pop.addEventListener('pointerleave', function(e){ if (e.pointerType !== 'touch') later(); });
      //=== 横にスクロールしたら、札が指している ID が動くので消す
      scroller.addEventListener('scroll', off, { passive: true });
      marks.forEach(function(g){
        g.list.forEach(function(m, j){
          var a = inner.appendChild(document.createElement('a'));
          a.className = 'rl-tid ' + cls(m); a.href = '#' + anchor(m); a.textContent = m.id;
          a.style.left = cx(g.d) + 'px'; a.style.top = (top + j * 17) + 'px';
          a.addEventListener('pointerenter', function(e){ if (e.pointerType !== 'touch') show(a, m); });
          a.addEventListener('pointerleave', function(e){ if (e.pointerType !== 'touch') later(); });
          a.addEventListener('click', function(e){
            e.preventDefault();
            if (on === a && !pop.hidden) go(m); else show(a, m);
          });
        });
      });
    }

    //=== 選んだ計測点の窓の最終日までで棒を切る（レポートを畳むのと同じ理屈で、
    //===   過去の点に戻したときにグラフだけ最新のままにしない）。並べるのは直近30本まで（2.5.16。それまでは10本）。
    //===   入りきらない日は横にスクロールする（drawBars の DAY_W）
    function daysFor(d, p){
      if (!d.days || !d.days.length) return null;
      var k = -1;
      d.days.forEach(function(x, i){ if (x.d === p.end) k = i; });
      var ls = k < 0 ? d.days : d.days.slice(0, k + 1);
      //=== 窓の後ろにある途中の日（partial）も並べる
      if (k >= 0) ls = ls.concat(d.days.slice(k + 1).filter(function(x){ return x.partial; }));
      return ls.slice(-30);
    }

    //=== 「前の計測から入ったこと」の一覧。★ここは放っておくと文字の塊になる。
    //===   1回の更新で5〜8行増え、どれも同じ重さで並ぶので、どれを読めばいいか分からない。
    //===   ふせぎ方は2つだけ:
    //===     ① 日付が全部同じなら列をやめる（9/26 が7回並んでも読む役に立たない）
    //===     ② 先頭2行だけ出して、残りは畳む
    //===   ★これは「大事な順に書く」規約とセット。1行目に「なぜ動いたか」を書く
    var REC_SHOW = 2;
    function recList(head, rows){
      if (!rows || !rows.length) return "";
      var one = rows.every(function(r){ return r[0] === rows[0][0]; }) ? rows[0][0] : null;
      var li = function(r){
        return '<li>' + (one ? '' : '<b>' + r[0] + '</b>') + '<span>' + r[1] + '</span></li>';
      };
      var top = rows.slice(0, REC_SHOW), rest = rows.slice(REC_SHOW);
      var h = '<div class="hr-head">' + head + (one ? ' <em>' + one + '</em>' : '') + '</div>'
            + '<ul>' + top.map(li).join('') + '</ul>';
      if (rest.length)
        h += '<details class="fold rec-more"><summary>ほか ' + rest.length + ' 件</summary>'
           + '<ul>' + rest.map(li).join('') + '</ul></details>';
      return h;
    }

    var box = document.querySelector('[data-hist]');
    var d = DATA.hist;
    if (!box || !d) return;
    var id = box.getAttribute('data-hist');
    var cur = d.points.length - 1;
    var elNote = box.querySelector(".hist-note"), elChart = box.querySelector(".hist-chart"),
        elRecs = box.querySelector(".hist-recs"),
        elReport = box.querySelector(".hist-report"),
        elWhen = document.querySelector('[data-goal-when="'+id+'"]'),
        elNow = document.querySelector('[data-goal-now="'+id+'"]'),
        elFill = document.querySelector('[data-goal-fill="'+id+'"]'),
        elDiff = document.querySelector('[data-goal-diff="'+id+'"]'),
        elMoney = document.querySelector('[data-goal-money="'+id+'"]');
    function render(){
      var p = d.points[cur];
      //=== 日付と値は上のゲージが持っている。ここに出すと同じことを2回言うことになる
      //=== ★ note の \n は改行として出す。1行が100字を超えると、13px の灰色の塊になる。
      //===   innerHTML は使わない（テキストのまま扱い、<br> だけを自分で足す）
      elNote.textContent = '';
      String(p.note || '').split('\n').forEach(function(line, i){
        if (i) elNote.appendChild(document.createElement('br'));
        elNote.appendChild(document.createTextNode(line));
      });
      //=== ⚠️ 注意書きは innerHTML の中に入れる。afterend で足すと render のたびに増える
      drawChart(elChart, d.points, d.target, d.unit, cur, daysFor(d, p), d.dayUnit, d.dayTarget, d.dayTargetUnit, d.line, d.targetLabel, { ofLabel: d.ofLabel, vLabel: d.vLabel });
      var head = cur === 0 ? "この計測までに入ったこと" : "前の計測から、この計測までに入ったこと";
      elRecs.innerHTML = recList(head, p.recs) +
        recList("この計測のあとに入ったこと（次の計測で判定に使う）", d.after);
      //=== ★上のゲージも選んだ時点に合わせる。ここが動かないと「遡れた」ことにならない。
      if (elNow) elNow.textContent = fmt(p.value);
      //=== 単価を持つループは、金額の下に枚数を添える（1枚250円）
      if (elMoney && d.price) elMoney.textContent = Math.round(p.value / d.price) + '件';
      if (elFill) elFill.style.width = Math.max(0, Math.min(100, p.value / d.target * 100)) + "%";
      if (elDiff) {
        if (cur === 0) { elDiff.textContent = "はじめて取った日"; }
        else {
          var prev = d.points[cur-1], diff = p.value - prev.value;
          elDiff.textContent = prev.label.replace("月","/").replace("日","") + " → " +
            p.label.replace("月","/").replace("日","") + " で " + (diff > 0 ? "＋" : diff < 0 ? "−" : "±") + fmt(Math.abs(diff));
        }
      }
      //=== レポートは「いまの数字の内訳」。常に最新の1窓ぶんだけを出す
      if (elReport) elReport.hidden = false;
      //=== 大きい数字の上は「いま」ではなく、その計測日にする
      if (elWhen) elWhen.textContent = p.label;
    }
    render();
    //=== 幅の変化で描き直す（実寸で描いているので必要）
    (window.LOOP_REDRAWS = window.LOOP_REDRAWS || []).push(render);
  })();

  /* ── 横向きファネル ── */
  (function(){
    //=== 高さは値の**対数**。実数だと先頭と末尾で桁が違い、末尾が線になって消えるため。
    var SEQ = ['#7d9a4e', '#a0a84a', '#c08a2e', '#b06b25', '#8f4a3a'];
    var CSSV = getComputedStyle(document.documentElement);
    var V = function(n){ return CSSV.getPropertyValue(n).trim(); };
    var FONT = getComputedStyle(document.body).fontFamily;

    function drawFunnel(box, d){
      var st = d.stages, n = st.length;
      var rate = st.map(function(s,i){ return i === 0 ? null : Math.round(s.value / st[i-1].value * 100); });
      //=== ★ fmt を通す。通さないと同じ頁で rank は「2,585件」なのにファネルは「2944人」になる
      var label = function(i){ return fmt(st[i].value) + (st[i].unit || ''); };

      //=== D3 が読めなかったとき（オフライン等）。数字だけは必ず出す
      if (!window.d3) {
        box.innerHTML = '<div class="fallback">' + st.map(function(s,i){
          return '<span>' + s.name + '<b>' + label(i) + '</b>' +
                 (rate[i] === null ? '' : ' <span style="font-size:12px">(' + rate[i] + '%)</span>') + '</span>';
        }).join('') + '</div>';
        return;
      }

      var W = box.clientWidth;
      if (!W) return;
      var narrow = W < 560;
      var H = narrow ? 210 : 250, mL = 34, mR = 34, mT = 46, mB = 44;
      var iw = W - mL - mR, ih = H - mT - mB, cy = mT + ih / 2;
      box.innerHTML = '';
      var svg = d3.select(box).append('svg').attr('width', W).attr('height', H);

      var lg = function(v){ return Math.log10(v + 1); };
      var hMax = lg(st[0].value);
      var h = st.map(function(s){ return Math.max(6, ih * lg(s.value) / hMax); });
      var X = st.map(function(_, i){ return mL + iw * i / (n - 1); });

      //=== 段のあいだを台形でつなぐ。中央に通過率
      var segs = [];
      for (var i = 0; i < n - 1; i++) {
        var sg = svg.append('g').attr('class', 'fseg').style('cursor', 'default');
        segs.push(sg);
        sg.append('polygon')
          .attr('points', [
            [X[i], cy - h[i]/2], [X[i+1], cy - h[i+1]/2],
            [X[i+1], cy + h[i+1]/2], [X[i], cy + h[i]/2]
          ].join(' '))
          .attr('fill', SEQ[i % SEQ.length]);
        sg.append('text').style('pointer-events', 'none')
          .attr('x', (X[i] + X[i+1]) / 2).attr('y', cy + 4).attr('text-anchor', 'middle')
          .attr('font-size', narrow ? 11 : 13).attr('font-weight', 600)
          .attr('fill', '#fff').attr('font-family', FONT)
          .text(rate[i+1] + '%');
      }
      //=== 境目の縦線と、上に段名・下に値
      st.forEach(function(s, i){
        var anc = i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle';
        svg.append('line').attr('x1', X[i]).attr('x2', X[i])
          .attr('y1', cy - h[i]/2 - 8).attr('y2', cy + h[i]/2 + 8)
          .attr('stroke', V('--line-soft')).attr('stroke-width', 1);
        svg.append('text').attr('x', X[i]).attr('y', mT - 24).attr('text-anchor', anc)
          .attr('font-size', narrow ? 10.5 : 12).attr('fill', V('--sub')).attr('font-family', FONT)
          .text(s.name);
        svg.append('text').attr('x', X[i]).attr('y', mT - 6).attr('text-anchor', anc)
          .attr('font-size', narrow ? 14 : 16).attr('font-weight', 600)
          .attr('fill', V('--ink')).attr('font-family', FONT)
          .text(label(i));
      });
      //=== 触ると: その帯だけ濃く残し、帯の下に「ここで抜けた数」を出す。
      //===   ★段の数と通過率はもう書いてある。書いていないのは、その間で失った数だけ。
      //===     単位が違う段のあいだ（人 → 件）は引き算できないので、帯を残すだけにする
      var lost = svg.append('text').attr('text-anchor', 'middle').attr('display', 'none')
        .attr('font-size', narrow ? 12 : 13).attr('font-weight', 700).attr('fill', V('--bad')).attr('font-family', FONT);
      segs.forEach(function(sg, i){
        function on(){
          segs.forEach(function(o, j){ o.attr('opacity', j === i ? 1 : 0.35); });
          var a = st[i], b = st[i+1];
          if ((a.unit || '') !== (b.unit || '')) { lost.attr('display', 'none'); return; }
          lost.attr('display', null).attr('x', (X[i] + X[i+1]) / 2)
            .attr('y', cy + Math.max(h[i], h[i+1]) / 2 + 18)
            .text('−' + fmt(a.value - b.value) + (b.unit || ''));
        }
        sg.on('pointerenter pointerdown', on)
          .on('pointerleave', function(ev){
            if (ev.pointerType === 'touch') return;
            segs.forEach(function(o){ o.attr('opacity', 1); });
            lost.attr('display', 'none');
          });
      });
      if (d.note) {
        svg.append('text').attr('x', mL).attr('y', H - 10)
          .attr('font-size', 11.5).attr('fill', V('--dim')).attr('font-family', FONT)
          .text(d.note);
      }
    }

    //=== ★ファネルは施策の中でも使う（data-rl の t:"funnel"）。同じ絵を2回書かないため、
    //===   描き手を1つだけ外に出す。呼ぶ側は {stages:[{name,value,unit}], note} を渡す
    window.RL_FUNNEL = drawFunnel;

    function drawAll(){
      if (!DATA.funnel) return;
      document.querySelectorAll('[data-funnel]').forEach(function(box){
        drawFunnel(box, DATA.funnel);
      });
    }
    drawAll();
    (window.LOOP_REDRAWS = window.LOOP_REDRAWS || []).push(drawAll);
  })();



  //=== 右の窓の開閉（アプリが画面ごと幅を変える）や画面幅の変化で iframe の幅が変わる。実寸で描いた図をまとめて描き直す。
  //===   連続で来るので 120ms 間引く
  var t;
  addEventListener('resize', function(){
    clearTimeout(t);
    t = setTimeout(function(){ (window.LOOP_REDRAWS || []).forEach(function(f){ f(); }); }, 120);
  });

  //=== ★折りたたみを開いたときも描き直す。閉じているあいだは幅が0で、
  //===   実寸で描く図（ファネル・折れ線）は「描かずに戻る」ので、開いても空のままになる。
  //===   toggle はバブリングしないので capture で拾う
  document.addEventListener('toggle', function(e){
    if (!e.target || e.target.tagName !== 'DETAILS' || !e.target.open) return;
    (window.LOOP_REDRAWS || []).forEach(function(f){ f(); });
  }, true);
})();
/* ── ボタンの呼び名と置き場所（殻とループ頁の両方。2.4.7・2.4.9） ── */
//=== 頁の HTML は書き換えずに、開いたときに文字と置き場所だけ直す（雛形を変えると全プロジェクトで頁の作り直しが要るため）
(function(){
  //=== セクションのボタン（一覧のヘッダ・ゴール・ボトルネック）は［カスタマイズ］。施策の実行・施策の評価のセクションのボタンは出さない。
  //===   項目のボタン（施策案・TRIAL・施策の評価の各施策）は［AIに指示］
  [].forEach.call(document.querySelectorAll('button.cmt, button.do, button.ins'), function(b){
    if (b.classList.contains('cmt') && !b.classList.contains('record-comment')){
      var sec = b.getAttribute('data-sec');
      if (sec === '施策の実行' || sec === '施策の評価'){ b.remove(); return; }
      b.textContent = 'カスタマイズ';
    } else b.textContent = 'AIに指示';
    //=== 施策案の［AIに指示］の左に［↓ 実行へ移動］、TRIAL の［AIに指示］の左に［↓ 評価へ移動］（2.5.8）。
    //===   施策案の行は「札・文・ボタン」の3列なので、2つのボタンを1つの箱にまとめて3列目に置く
    if ((b.classList.contains('do') || b.classList.contains('ins')) && !b.classList.contains('record-comment')){
      var isDo = b.classList.contains('do'), mv = document.createElement('button');
      mv.className = isDo ? 'mv-do' : 'mv-ins';
      ['data-id', 'data-no', 'data-text', 'data-loop'].forEach(function(a){ if (b.hasAttribute(a)) mv.setAttribute(a, b.getAttribute(a)); });
      mv.textContent = isDo ? '実行へ移動' : '評価へ移動';
      if (isDo){
        var box = document.createElement('span');
        box.className = 'item-btns';
        b.parentNode.insertBefore(box, b);
        box.appendChild(mv);
        box.appendChild(b);
      } else b.parentNode.insertBefore(mv, b);
    }
    //=== 実行中の施策の状態の一文（.trial-status）は、ボタンの横だとせせこましいので、題の下の段に置く
    if (b.classList.contains('ins')){
      var trial = b.closest('.trial'), st = trial && trial.querySelector('.trial-top .trial-status');
      if (st) trial.querySelector('.trial-top').insertAdjacentElement('afterend', st);
    }
    //=== 施策の評価の各施策の［AIに指示］は、施策の題の右に置く（頁の HTML では本文の下にある）
    if (b.classList.contains('record-comment')){
      var top = b.closest('.record-item') && b.closest('.record-item').querySelector('.record-top');
      if (top) top.appendChild(b);
    }
  });
})();
/* ── 見出しの貼り付け（殻とループ頁の両方） ── */
(function(){
  //=== 見出しが上に貼り付いているあいだは .stuck を付け、上の線の幅をセクションに合わせる（頁は 2.4.4、一覧は 2.4.5。rising.css）。
  //===   殻（一覧）とループ頁の両方で動く。文字は「← 一覧へ」（頁にだけある）と重なるときだけ、ボタンの右端から 12px 空く所までずらす（広い画面では本体が中央寄りで、重ならない）。
  //===   Safari でも動くように、CSS の新しい機能（scroll-state）ではなくスクロールで見る
  var tabs = [].slice.call(document.querySelectorAll('.flow .section.tabbed .sec-tab'));
  var back = document.querySelector('.back');
  function markStuck(){
    tabs.forEach(function(tab){
      var sec = tab.parentElement.getBoundingClientRect();
      tab.classList.toggle('stuck', sec.top < 0 && sec.bottom > tab.offsetHeight + 4);
      tab.style.setProperty('--sec-w', Math.round(sec.width) + 'px');
      //=== ずらす前の文字の左端（見出しの左端＋左の余白）と、ボタンの右端＋12px を比べる
      var textLeft = sec.left + parseFloat(getComputedStyle(tab).paddingLeft);
      var need = back ? Math.ceil(back.getBoundingClientRect().right + 12 - textLeft) : 0;
      tab.style.setProperty('--shift', Math.max(0, need) + 'px');
    });
  }
  //=== 見出しは数個なので、スクロールのたびにすぐ測る（requestAnimationFrame を待つと、窓が隠れているあいだ測られない）。
  //===   「← 一覧へ」は左から滑り込むので、滑り込み終わったときにも測り直す
  if (tabs.length){
    addEventListener('scroll', markStuck, { passive: true });
    addEventListener('resize', markStuck);
    if (back) back.addEventListener('animationend', markStuck);
    markStuck();
  }
})();
/* ══════════════════════════════════════════════════════════════════
   図の部品（1.7.0）。data-rl を読んで中身を組み立てる
   ★殻（一覧）とループ頁の両方で動く（1.7.4 で頁の中から外へ出した）
   ------------------------------------------------------------------
   ★ 頁に書くのは1行だけ。SVG も div の入れ子も書かない。
       <div class="rl" data-rl='{"t":"bullet","max":24,"now":1.37,"aim":24,"unit":"円"}'></div>
   ★ どの t を使うかはデータの形で決まる（references/HTML生成.md の引き金の表）。
     センスで選ばない。表に無い形のときだけ、その場で描いてよい。
   ★ ここに無い図を手で SVG で描くと、版が離れたときに部品とずれる。
     1.6.x では見本・頁・rising.js に3種類のファネルが生えた。だから1本にする。
   ★ 値だけを差し替えるので、update/LXX.py からも触れる（data-rl は JSON）。
   ══════════════════════════════════════════════════════════════════ */
(function(){
  //=== 並びの色。濃い→薄いの順。SEQ（ファネル）とは別。内訳は「上が多い」が読めればよい
  //=== ★殻（一覧）でも動く。殻には LOOP_DATA が無いので、無ければ空として扱う
  var DATA = (typeof LOOP_DATA !== 'undefined' && LOOP_DATA) ? LOOP_DATA : {};
  var C = ['#52751f', '#7d9c48', '#a7c184', '#c9d3bd', '#dfe6d6'];
  var BAD = '#b95448', INK = '#1c2821', DIM = '#7c8b80', SOFT = '#dfe6d6';
  var MONO = 'ui-monospace,SFMono-Regular,Menlo,monospace';

  //=== ★画面に出る文字はここを必ず通す。data-rl は AI が書くので、
  //===   単位やラベルに < や " が混ざると markup が壊れる。' も属性に入るので落とす
  //=== ★ラベルのキーを揃える。LOOP_DATA の days[] は d、部品は k。
  //===   揃えないと "@hist.days[]" をそのまま渡せず、写しを作るはめになる
  function lab(x){ return x && (x.k != null ? x.k : x.d); }

  function esc(s){
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  //=== 0除算を出さない。母数が 0 のループは実際にある（初日・0件）
  function pc(v, max){ return !max ? 0 : Math.max(0, Math.min(100, n0(v) / max * 100)); }
  function mx(a){ return a.reduce(function(m, v){ return v > m ? v : m; }, 0); }
  //=== ★数字はここを必ず通す。キーが無い・null・文字列でも 0 になる。
  //===   通さないと fmt(undefined) が画面に "NaN" と出る（ベン図で実際に出た）
  function n0(v){ var x = +v; return isFinite(x) ? x : 0; }
  //=== 単位も esc を通す。通さないと d.unit の "<em>円" がそのまま markup になる
  function num(v, unit){ return fmt(n0(v)) + (unit ? esc(unit) : ''); }
  function ttl(s){ return s ? '<div class="rl-ttl">' + esc(s) + '</div>' : ''; }
  //=== 札の文を属性に置く。★札には画面にまだ書いていない数字だけ（RL_TIP の決まり）
  function tip(s){ return s ? ' data-tip="' + esc(s) + '"' : ''; }
  //=== 全体に占める割合。1%未満は小数1桁まで出す（0% と書くと「無い」に見える）
  function share(v, sum){ if (!sum) return ''; var r = n0(v) / sum * 100; return (r > 0 && r < 1 ? r.toFixed(1) : Math.round(r)) + '%'; }
  //=== 増えた・減った分。符号は ＋ と −（ハイフンにしない）
  function diff(a, b, unit){ var x = n0(b) - n0(a); return (x > 0 ? '+' : x < 0 ? '−' : '±') + fmt(Math.abs(x)) + (unit || ''); }
  function note(s){ return s ? '<div class="rl-note">' + esc(s) + '</div>' : ''; }
  function key(items){
    return '<div class="rl-key">' + items.map(function(it){
      return '<span><i style="background:' + it.c + '"></i>' + esc(it.k) + '</span>';
    }).join('') + '</div>';
  }
  //=== 目盛りの値。刻みは 4 が既定（0 と max を含めて5本）
  //=== ★両端の札は端に寄せる。中央寄せのままだと半分が枠の外に出て、隣の欄と重なる
  function ticks(max, n, unit){
    var out = '';
    for (var i = 0; i <= n; i++){
      var v = max * i / n;
      var cls = i === 0 ? ' class="e0"' : i === n ? ' class="e1"' : '';
      out += '<span' + cls + ' style="left:' + (i / n * 100) + '%">' + (i ? num(v, unit) : '0') + '</span>';
    }
    return out;
  }


  //=== ★色の決まり（どの図でも同じ）: **はじめより悪くなっていたら赤**。それ以外は緑。
  //===   「悪い」の向きは目標で決まる。上げたい目標は下がったら赤、
  //===   上限の目標（サーバー代など）は上がったら赤。aimLabel が「上限」か lower:true で逆にする。
  //===   はじめが無いときは向きが分からないので、どちらにも塗らない（中立 ''）。
  //===   ok を明示したときはそれが勝つ。★一覧の行の帯もこれで塗る（判定を2か所に持たない）
  function toneOf(d){
    var lower = d.lower === true || d.aimLabel === '上限';
    return d.ok === true ? 'ok' : d.ok === false ? 'bad'
         : d.was == null ? ''
         : (lower ? n0(d.now) > n0(d.was) : n0(d.now) < n0(d.was)) ? 'bad' : 'ok';
  }
  //=== 「はじめより ＋75%」。はじめが 0 のときは割れないので出さない
  function deltaOf(d){
    if (d.was == null || !n0(d.was)) return '';
    var r = (n0(d.now) - n0(d.was)) / Math.abs(n0(d.was)) * 100;
    return (r >= 0 ? '↑ はじめより +' : '↓ はじめより −') + Math.round(Math.abs(r)) + '%';
  }

  /* ── 1. bullet（軸つきブレット）いま・目標・まえ を1本の目盛りに ── */
  //=== ①道 と ②軸つき棒 を1つにしたもの。目盛りが入るので差が何倍でも潰れない
  function bullet(d){
    var max = d.max != null ? d.max : Math.max(d.aim || 0, d.now || 0, d.was || 0);
    var n = d.ticks || 4, h = '';
    //=== 色は toneOf（上）。一覧の行の帯と同じ決まり
    var tone = toneOf(d);
    //=== ★ axis:false で目盛りの数字を出さない（線だけ）。一覧の行のように幅が狭い場所で使う
    if (d.axis !== false) h += '<div class="ax">' + ticks(max, n, d.unit) + '</div>';
    //=== 札: 目標（上限）までの残り。いま・目標・まえは書いてあるので、書いていないのは差だけ
    var gap = '';
    if (d.aim != null){
      var lw = d.lower === true || d.aimLabel === '上限', rest = n0(d.aim) - n0(d.now), al = d.aimLabel || '目標';
      gap = (lw ? rest >= 0 : rest > 0) ? al + 'まで あと ' + fmt(Math.abs(rest)) + (d.unit || '')
                                        : al + 'を ' + fmt(Math.abs(rest)) + (d.unit || '') + ' 超え';
    }
    h += '<div class="tr"' + tip(gap) + '>';
    for (var i = 1; i < n; i++) h += '<i class="g" style="left:' + (i / n * 100) + '%"></i>';
    h += '<i class="val' + (tone ? ' ' + tone : '') + '" style="width:' + pc(d.now, max).toFixed(1) + '%"></i>';
    //=== ★札は印の真ん中に置くので、0% や 100% ぴったりだと半分が枠の外に出る。
    //===   両端を 1〜99% に寄せる（右端は 1.6.x の頁で、左端は was:0 で実際にはみ出した）
    var edge = function(v){ return Math.max(1, Math.min(99, pc(v, max))).toFixed(1); };
    //=== ★札は印の真ん中に置くので、端に近いと外にはみ出す。
    //===   左寄り（12%未満）は左端に、右寄り（88%超）は右端に揃える
    var side = function(v){ var x = pc(v, max); return x < 12 ? ' e0' : x > 88 ? ' e1' : ''; };
    if (d.was != null)
      h += '<i class="was' + side(d.was) + '" style="left:' + edge(d.was) + '%"><em>'
         + esc(d.wasLabel || 'まえ') + ' ' + num(d.was, d.unit) + '</em></i>';
    if (d.aim != null)
      h += '<i class="aim' + side(d.aim) + '" style="left:' + edge(d.aim) + '%"><em>'
         + esc(d.aimLabel || '目標') + ' ' + num(d.aim, d.unit) + '</em></i>';
    h += '</div>';
    //=== ★ゴールの枠のように、いまと目標が図の左右に大きく出ている場所では lg:false で凡例を消す。
    //===   同じ数字を2回言わない（1.6.x の頁で「いま」が3か所に出ていた）
    if (d.lg !== false)
      h += '<div class="lg">' + esc(d.nowLabel || 'いま') + ' <b' + (tone ? ' class="' + tone + '"' : '') + '>'
         + num(d.now, d.unit) + '</b>' + (d.lead ? '　' + esc(d.lead) : '') + '</div>';
    return h;
  }

  /* ── 3. rank（横棒ランキング）0件も行として残る ── */
  //=== ④内訳 と A内訳ランキング を1つにしたもの。0 が消えないのはこの図だけ。
  //===   ★中身は既存の .rv-h をそのまま出す。1.3.x からある横棒で、プレイルームで28か所使っている。
  //===     ここで別の markup を作ると、同じ絵が2通りになる（ファネルで起きたのと同じこと）
  function rank(d){
    var rows = d.rows || [], max = mx(rows.map(function(r){ return n0(r.v); }));
    var sum = rows.reduce(function(a, r){ return a + n0(r.v); }, 0);
    return ttl(d.title) + '<div class="rv-h">' + rows.map(function(r, i){
      var v = n0(r.v);
      //=== 先頭だけ濃い緑、あとは薄い（.rv-h に赤は無いので bad は見ない）
      return '<div class="k">' + esc(lab(r)) + '</div>'
           + '<div class="t"' + tip('全体の ' + share(v, sum)) + '><i class="' + (i === 0 && v ? '' : 'dim') + '" style="width:'
           + pc(v, max).toFixed(1) + '%"></i></div>'
           + '<div class="v">' + fmt(v) + esc(d.unit || '') + '</div>';
    }).join('') + '</div>' + note(d.note);
  }

  /* ── 4. stack（帯100%）2つ以上に分ける。帯を並べると前後が見える ── */
  function stack(d){
    return (d.bands || []).map(function(b){
      var parts = b.parts || [], sum = parts.reduce(function(s, p){ return s + (+p.v || 0); }, 0);
      return ttl(b.title) + '<div class="rl-band">' + parts.map(function(p, i){
        var w = pc(p.v, sum);
        //=== 幅が細いと文字が入らない。8% 未満はラベルを落として色だけ残す
        //=== 札: 文字が入っている帯は割合だけ。文字を落とした細い帯は、名前と数と割合
        var tp = w >= 8 ? '全体の ' + share(p.v, sum) : esc(p.k) + ' ' + fmt(n0(p.v)) + (d.unit || '') + '（' + share(p.v, sum) + '）';
        return '<span' + tip(tp) + ' style="width:' + w.toFixed(1) + '%;background:' + (p.c || C[i % C.length]) + '">'
             + (w >= 8 ? esc(p.k) + ' ' + fmt(n0(p.v)) + (d.unit || '') : '') + '</span>';
      }).join('') + '</div>';
    }).join('') + note(d.note);
  }

  /* ── 5. cal（カレンダー）曜日のクセ。濃いほど多い ── */
  function cal(d){
    var days = d.days || [], max = mx(days.map(function(x){ return n0(x.v); })), h = '';
    (d.head || ['月','火','水','木','金','土','日']).forEach(function(w){ h += '<b>' + esc(w) + '</b>'; });
    days.forEach(function(x){
      var a = max ? n0(x.v) / max : 0;
      //=== 札: 日付と数。マスには何も書いていない
      h += '<i' + tip(lab(x) + ' ' + fmt(n0(x.v)) + (d.unit || '')) + ' style="background:rgba(82,117,31,'
         + (0.10 + a * 0.90).toFixed(2) + ')"></i>';
    });
    return ttl(d.title) + '<div class="gr">' + h + '</div>' + note(d.note);
  }

  /* ── 6. dumbbell（前 → いま）項目ごとに点を2つ置いて線でつなぐ ── */
  function dumbbell(d){
    var rows = d.rows || [];
    var max = d.max != null ? d.max : mx(rows.reduce(function(a, r){ return a.concat([n0(r.a), n0(r.b)]); }, []));
    return ttl(d.title) + rows.map(function(r){
      var A = pc(r.a, max), B = pc(r.b, max), up = n0(r.b) >= n0(r.a);
      //=== 札: 増えた・減った分。前といまは書いてある
      return '<div class="r' + (up ? ' up' : '') + '"' + tip(diff(r.a, r.b, d.unit)) + '><span class="k">' + esc(lab(r)) + '</span>'
           + '<span class="tr"><i class="ln" style="left:' + Math.min(A, B).toFixed(1)
           + '%;width:' + Math.abs(B - A).toFixed(1) + '%"></i>'
           + '<i class="a" style="left:' + A.toFixed(1) + '%"></i>'
           + '<i class="b" style="left:' + B.toFixed(1) + '%"></i></span>'
           + '<span class="v">' + num(r.a, d.unit) + ' → ' + num(r.b, d.unit) + '</span></div>';
    }).join('') + note(d.note);
  }

  /* ── 7. hist（ヒストグラム）ばらつき。平均では消える形 ── */
  //=== ★中身は既存の .rv-bars / .rv-col / .rv-labels をそのまま出す（縦棒。1.3.x からある）。
  //===   いちばん高い山だけ濃くする。どこが多いかを目で拾えるようにする
  function hist(d){
    var bins = d.bins || [], max = mx(bins.map(function(b){ return n0(b.v); }));
    var sum = bins.reduce(function(a, b){ return a + n0(b.v); }, 0);
    return ttl(d.title)
      + '<div class="rv-bars">' + bins.map(function(b){
          var v = n0(b.v);
          //=== 札: 全体の何%か。件数は柱の上に書いてある
          return '<div class="rv-col' + (max && v === max ? ' on' : '') + '"' + tip('全体の ' + share(v, sum)) + '><b>' + fmt(v) + '</b>'
               + '<i style="height:' + pc(v, max).toFixed(1) + '%"></i></div>';
        }).join('') + '</div>'
      + '<div class="rv-labels">' + bins.map(function(b){
          return '<span' + (max && n0(b.v) === max ? ' class="on"' : '') + '>' + esc(lab(b)) + '</span>';
        }).join('') + '</div>'
      + note(d.note);
  }

  /* ── 8. funnel（段が減っていく）ゴールでも施策でも使う ── */
  //=== 描くのは rising.js のファネル1本だけ（window.RL_FUNNEL）。ここでは中身を渡すだけ。
  //===   ★段の数では選ばない。「桁が変わるほど減るか」で選ぶ（3段で10倍減る施策がある）
  function funnelSpec(d){
    return { note: d.note || '', stages: (d.stages || []).map(function(x){
      return { name: x.k || x.name, value: n0(x.v != null ? x.v : x.value), unit: x.unit || d.unit || '' };
    }) };
  }

  /* ── 9. pie（円）全体を3〜5に分ける ── */
  //=== 三角関数だけ。d3 が読めなくても描ける
  function arc(cx, cy, r, a0, a1){
    var x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    var x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    var big = (a1 - a0) > Math.PI ? 1 : 0;
    return 'M' + cx + ' ' + cy + ' L' + x0.toFixed(2) + ' ' + y0.toFixed(2)
         + ' A' + r + ' ' + r + ' 0 ' + big + ' 1 ' + x1.toFixed(2) + ' ' + y1.toFixed(2) + ' Z';
  }
  function pie(d){
    var sl = d.slices || [], sum = sl.reduce(function(s, x){ return s + n0(x.v); }, 0);
    var a = -Math.PI / 2, s = '<svg viewBox="0 0 120 120">', k = [];
    if (!sum) return '<div class="rl-none">まだ数字がありません</div>';
    sl.forEach(function(x, i){
      var c = x.c || C[i % C.length], a2 = a + n0(x.v) / sum * Math.PI * 2, mid = (a + a2) / 2;
      //=== 札: 実際の数。割合は凡例に書いてある。触った切れは外へ少しずらす
      s += '<path d="' + arc(60, 60, 54, a, a2) + '" fill="' + c + '"' + tip(fmt(n0(x.v)) + (d.unit || ''))
         + ' style="--dx:' + (Math.cos(mid) * 4).toFixed(2) + 'px;--dy:' + (Math.sin(mid) * 4).toFixed(2) + 'px"/>';
      k.push({ k: x.k + ' ' + Math.round(n0(x.v) / sum * 100) + '%', c: c });
      a = a2;
    });
    return ttl(d.title) + '<div class="rl-pie">' + s + '</svg>' + key(k) + '</div>' + note(d.note);
  }

  /* ── 10. donut（粒）1%未満。中に母数 ── */
  //=== ⑥点 の置き換え。円周を dasharray で切るだけなので、0.5% でも線が残る
  function donut(d){
    var total = n0(d.total), hit = n0(d.hit), R = 50, L = 2 * Math.PI * R;
    var on = total ? Math.max(1.2, L * hit / total) : 0;   //=== 細すぎて消えないよう最低 1.2
    var s = '<svg viewBox="0 0 130 130">'
      + '<circle cx="65" cy="65" r="' + R + '" fill="none" stroke="' + SOFT + '" stroke-width="17"/>'
      + '<circle cx="65" cy="65" r="' + R + '" fill="none" stroke="' + BAD + '" stroke-width="17"'
      + ' stroke-dasharray="' + on.toFixed(2) + ' ' + L.toFixed(0) + '" transform="rotate(-90 65 65)"/>'
      + '<text x="65" y="62" text-anchor="middle" font-size="25" font-weight="700" fill="' + INK + '" font-family="' + MONO + '">'
      + fmt(total) + '</text>'
      + '<text x="65" y="79" text-anchor="middle" font-size="11" fill="' + DIM + '">' + esc(d.totalLabel || '') + '</text>'
      + '<text x="65" y="97" text-anchor="middle" font-size="12" font-weight="700" fill="' + BAD + '" font-family="' + MONO + '">'
      + esc(d.hitLabel || ('うち ' + fmt(hit))) + '</text></svg>';
    var tx = (d.lines || []).map(function(l){ return esc(l); }).join('<br>');
    //=== 札: 割合。母数と件数は輪の中に書いてある
    s = s.replace('<svg ', '<svg' + tip(share(hit, total)) + ' ');
    return ttl(d.title) + '<div class="rl-donut">' + s + (tx ? '<div class="tx">' + tx + '</div>' : '') + '</div>' + note(d.note);
  }

  /* ── 11. treemap（面積で内訳）大きさの差が激しいとき ── */
  //=== d3.treemap（矩形の敷き詰め）を使う。
  //===   ★ d3 が読めないときは横棒に落とす。落とさないとここで例外になり、
  //===     同じ頁の以降の図が全部消える（オフラインで L08 の5図中4図が空白になった）
  function treemap(d){
    var cells = (d.cells || []).filter(function(c){ return n0(c.v) > 0; });
    if (!cells.length) return '<div class="rl-none">まだ数字がありません</div>';
    if (!window.d3 || !d3.treemap || !d3.hierarchy)
      return rank({ title: d.title, unit: d.unit, rows: d.cells, note: d.note });
    var W = 300, H = 150, sum = cells.reduce(function(a, c){ return a + n0(c.v); }, 0);
    var root = d3.hierarchy({ children: cells }).sum(function(x){ return n0(x.v); })
                 .sort(function(a, b){ return b.value - a.value; });
    d3.treemap().size([W, H]).paddingInner(2)(root);
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '">';
    root.leaves().forEach(function(n, i){
      var w = n.x1 - n.x0, h = n.y1 - n.y0, c = C[i % C.length], fg = i < 2 ? '#fff' : INK;
      s += '<rect x="' + n.x0.toFixed(1) + '" y="' + n.y0.toFixed(1) + '" width="' + w.toFixed(1)
         + '" height="' + h.toFixed(1) + '" fill="' + c + '"'
         //=== 札: 文字が入る枠は割合だけ。小さくて文字を落とした枠は、名前と数と割合
         + tip(w > 52 && h > 30 ? '全体の ' + share(n.data.v, sum)
                                : n.data.k + ' ' + fmt(n0(n.data.v)) + (d.unit || '') + '（' + share(n.data.v, sum) + '）') + '/>';
      //=== 小さい枠に文字を入れると読めない。幅52・高さ30 を下回ったら出さない
      if (w > 52 && h > 30){
        s += '<text x="' + (n.x0 + 7).toFixed(1) + '" y="' + (n.y0 + 18).toFixed(1)
           + '" font-size="11" fill="' + fg + '">' + esc(n.data.k) + '</text>'
           + '<text x="' + (n.x0 + 7).toFixed(1) + '" y="' + (n.y0 + 35).toFixed(1)
           + '" font-size="13" font-weight="700" fill="' + fg + '" font-family="' + MONO + '">'
           + num(n.data.v, d.unit) + '</text>';
      }
    });
    return ttl(d.title) + s + '</svg>' + note(d.note);
  }

  /* ── 12. area（面グラフ）合計の推移と、その内訳 ── */
  function area(d){
    var ser = d.series || [], labels = d.labels || [];
    var n = Math.max.apply(null, ser.map(function(s){ return (s.vals || []).length; }).concat([1]));
    var tot = [], i, j;
    for (i = 0; i < n; i++){
      var t = 0;
      for (j = 0; j < ser.length; j++) t += n0(ser[j].vals && ser[j].vals[i]);
      tot.push(t);
    }
    var max = mx(tot) || 1, W = 300, H = 120, PB = 16;
    var X = function(i){ return n < 2 ? W / 2 : i / (n - 1) * W; };
    var Y = function(v){ return (H - PB) - (H - PB) * (v / max); };
    var base = new Array(n).fill(0), s = '<svg viewBox="0 0 ' + W + ' ' + H + '">', k = [];
    ser.forEach(function(sr, si){
      var up = [], dn = [];
      for (i = 0; i < n; i++){
        var v = base[i] + n0(sr.vals && sr.vals[i]);
        up.push(X(i).toFixed(1) + ' ' + Y(v).toFixed(1));
        dn.unshift(X(i).toFixed(1) + ' ' + Y(base[i]).toFixed(1));
        base[i] = v;
      }
      var c = sr.c || C[si % C.length];
      s += '<polygon points="' + up.concat(dn).join(' ') + '" fill="' + c + '"/>';
      k.push({ k: sr.k, c: c });
    });
    s += '<line x1="0" y1="' + (H - PB) + '" x2="' + W + '" y2="' + (H - PB) + '" stroke="#c9d3bd"/>'
       + '<line class="rl-guide" x1="0" x2="0" y1="0" y2="' + (H - PB) + '" stroke="' + INK + '" stroke-opacity=".45" stroke-dasharray="2 3" visibility="hidden"/>';
    labels.forEach(function(l, i){
      if (!l) return;
      s += '<text x="' + X(i).toFixed(1) + '" y="' + (H - 4) + '" font-size="9.5" fill="' + DIM
         + '" text-anchor="middle">' + esc(l) + '</text>';
    });
    return ttl(d.title) + s + '</svg>' + key(k) + note(d.note);
  }

  /* ── 13. slope（傾き）2時点だけ。順位が入れ替わったか ── */
  function slope(d){
    var rows = d.rows || [], W = 260, H = 130, PT = 22, PB = 12;
    var max = d.max != null ? d.max
            : mx(rows.reduce(function(a, r){ return a.concat([n0(r.a), n0(r.b)]); }, [])) || 1;
    var Y = function(v){ return PT + (H - PT - PB) * (1 - v / max); };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '">'
      + '<text x="70" y="12" font-size="10" fill="' + DIM + '" text-anchor="end">' + esc(d.left || 'まえ') + '</text>'
      + '<text x="190" y="12" font-size="10" fill="' + DIM + '">' + esc(d.right || 'いま') + '</text>';
    rows.forEach(function(r, i){
      var up = n0(r.b) >= n0(r.a), c = up ? C[0] : BAD;
      var y0 = Y(n0(r.a)), y1 = Y(n0(r.b));
      //=== 札: 増えた・減った分。両端の数は書いてある。触った線だけ残して、ほかは薄くする
      s += '<g class="sl"' + tip(r.k + ' ' + diff(r.a, r.b, d.unit)) + '>'
         //=== 細い線に当てさせない。透明の太い線を下に敷いて、触れる幅を広げる
         + '<line x1="70" y1="' + y0.toFixed(1) + '" x2="190" y2="' + y1.toFixed(1) + '" stroke="transparent" stroke-width="12"/>'
         + '<line x1="70" y1="' + y0.toFixed(1) + '" x2="190" y2="' + y1.toFixed(1)
         + '" stroke="' + c + '" stroke-width="2"/>'
         + '<circle cx="70" cy="' + y0.toFixed(1) + '" r="4" fill="' + c + '"/>'
         + '<circle cx="190" cy="' + y1.toFixed(1) + '" r="4" fill="' + c + '"/>'
         + '<text x="64" y="' + (y0 + 3.5).toFixed(1) + '" font-size="10" fill="' + INK
         + '" text-anchor="end">' + esc(r.k) + ' ' + num(r.a, d.unit) + '</text>'
         + '<text x="197" y="' + (y1 + 3.5).toFixed(1) + '" font-size="10" fill="' + c + '">'
         + num(r.b, d.unit) + '</text></g>';
    });
    return ttl(d.title) + s + '</svg>' + note(d.note);
  }

  /* ── 14. venn（ベン図）2つの集まりの重なり ── */
  function venn(d){
    var a = d.a || {}, b = d.b || {}, both = n0(d.both);
    //=== 札: その円のうち、両方に入っている割合。円の中の数は「その部分だけ」の数として読む
    var s = '<svg viewBox="0 0 260 120">'
      + '<circle cx="100" cy="60" r="48" fill="' + C[0] + '" opacity=".3"' + tip(a.k + 'のうち 両方は ' + share(both, n0(a.v) + both)) + '/>'
      + '<circle cx="160" cy="60" r="42" fill="' + BAD + '" opacity=".3"' + tip(b.k + 'のうち 両方は ' + share(both, n0(b.v) + both)) + '/>'
      + '<text x="60" y="56" font-size="11" fill="' + INK + '" text-anchor="middle">' + esc(a.k) + '</text>'
      + '<text x="60" y="74" font-size="14" fill="' + INK + '" text-anchor="middle" font-family="' + MONO + '">' + fmt(n0(a.v)) + '</text>'
      + '<text x="130" y="64" font-size="14" fill="#8e3c31" text-anchor="middle" font-family="' + MONO + '">' + fmt(both) + '</text>'
      + '<text x="200" y="56" font-size="11" fill="' + INK + '" text-anchor="middle">' + esc(b.k) + '</text>'
      + '<text x="200" y="74" font-size="14" fill="' + INK + '" text-anchor="middle" font-family="' + MONO + '">' + fmt(n0(b.v)) + '</text>'
      + '</svg>';
    return ttl(d.title) + s + note(d.note);
  }

  /* ── 15. scatter（散布図）2つの数字に関係があるか ── */
  //=== 1件ずつの生データが要る。日ごとの集計しか無いループでは使えない
  function scatter(d){
    var p = d.pts || [], W = 280, H = 130, PL = 30, PB = 18, PT = 8, PR = 6;
    if (!p.length) return '<div class="rl-none">まだ数字がありません</div>';
    var xs = p.map(function(o){ return n0(o.x); }), ys = p.map(function(o){ return n0(o.y); });
    var xM = mx(xs) || 1, yM = mx(ys) || 1;
    var X = function(v){ return PL + (W - PL - PR) * (v / xM); };
    var Y = function(v){ return (H - PB) - (H - PB - PT) * (v / yM); };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '">'
      + '<line x1="' + PL + '" y1="' + (H - PB) + '" x2="' + (W - PR) + '" y2="' + (H - PB) + '" stroke="#c9d3bd"/>'
      + '<line x1="' + PL + '" y1="' + PT + '" x2="' + PL + '" y2="' + (H - PB) + '" stroke="#c9d3bd"/>'
      + '<text x="2" y="' + (PT + 6) + '" font-size="9" fill="' + DIM + '">' + esc(d.y || '') + '</text>'
      + '<text x="' + (W - PR) + '" y="' + (H - 4) + '" font-size="9" fill="' + DIM + '" text-anchor="end">'
      + esc(d.x || '') + '</text>';
    p.forEach(function(o, i){
      s += '<circle data-i="' + i + '" cx="' + X(n0(o.x)).toFixed(1) + '" cy="' + Y(n0(o.y)).toFixed(1)
         + '" r="' + (o.out ? 5 : 4) + '" fill="' + (o.out ? BAD : C[2]) + '"/>';
    });
    return ttl(d.title) + s + '</svg>' + note(d.note);
  }

  var KINDS = {
    bullet: bullet, rank: rank, stack: stack, cal: cal,
    dumbbell: dumbbell, hist: hist, pie: pie, donut: donut,
    treemap: treemap, area: area, slope: slope, venn: venn, scatter: scatter
  };
  //=== 描いたあとに、自分で札を出す図（どこに乗せても、いちばん近いものに吸い付く）
  function vbX(svg, ev){
    var r = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
    return (ev.clientX - r.left) / r.width * vb.width;
  }
  function own(el, move, leave){
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerdown', move);
    el.addEventListener('pointerleave', function(ev){ if (ev.pointerType !== 'touch') { leave(); RL_TIP.hide(); } });
  }
  var INTER = {
    //=== 面グラフ: 縦の線を引き、札に合計、凡例にその時点の内訳を出す。★図には数字を1つも書いていない
    area: function(el, d){
      var svg = el.querySelector('svg'), guide = el.querySelector('.rl-guide');
      var keys = [].slice.call(el.querySelectorAll('.rl-key span'));
      var ser = d.series || [], labels = d.labels || [];
      var n = Math.max.apply(null, ser.map(function(s){ return (s.vals || []).length; }).concat([1]));
      keys.forEach(function(k, j){ k.setAttribute('data-k', ser[j] ? ser[j].k : ''); });
      own(svg, function(ev){
        var i = n < 2 ? 0 : Math.max(0, Math.min(n - 1, Math.round(vbX(svg, ev) / 300 * (n - 1))));
        var gx = n < 2 ? 150 : i / (n - 1) * 300, tot = 0;
        guide.setAttribute('x1', gx); guide.setAttribute('x2', gx); guide.setAttribute('visibility', 'visible');
        keys.forEach(function(k, j){
          var v = n0(ser[j] && ser[j].vals && ser[j].vals[i]); tot += v;
          k.lastChild.textContent = k.getAttribute('data-k') + ' ' + fmt(v);
        });
        RL_TIP.show((labels[i] ? labels[i] + '  ' : '') + '合計 ' + fmt(tot) + (d.unit || ''), ev.clientX, ev.clientY, el);
      }, function(){
        guide.setAttribute('visibility', 'hidden');
        keys.forEach(function(k){ k.lastChild.textContent = k.getAttribute('data-k'); });
      });
    },
    //=== 散布図: いちばん近い点に吸い付き、その点を大きくして、名前と2つの値を出す。★点には何も書いていない
    scatter: function(el, d){
      var svg = el.querySelector('svg'), dots = [].slice.call(svg.querySelectorAll('circle[data-i]')), on = null;
      function off(){ if (on){ on.setAttribute('r', on.getAttribute('data-r')); on.removeAttribute('stroke'); on = null; } }
      dots.forEach(function(c){ c.setAttribute('data-r', c.getAttribute('r')); });
      own(svg, function(ev){
        var best = null, bd = 1e9;
        dots.forEach(function(c){
          var r = c.getBoundingClientRect(), dx = r.left + r.width / 2 - ev.clientX, dy = r.top + r.height / 2 - ev.clientY;
          var dd = dx * dx + dy * dy; if (dd < bd){ bd = dd; best = c; }
        });
        //=== 遠すぎる（40px 超）ときは何も指さない
        if (!best || bd > 1600){ off(); RL_TIP.hide(); return; }
        if (best !== on){ off(); on = best; on.setAttribute('r', 6.5); on.setAttribute('stroke', '#fff'); on.setAttribute('stroke-width', 2); }
        var o = (d.pts || [])[+best.getAttribute('data-i')] || {};
        RL_TIP.show((o.k ? o.k + '  ' : '') + (d.x || 'x') + ' ' + fmt(n0(o.x)) + '・' + (d.y || 'y') + ' ' + fmt(n0(o.y)), ev.clientX, ev.clientY, el);
      }, off);
    }
  };
  //=== 一覧を受け取る図は、その一覧が空なら「まだ数字がありません」を出す。
  //===   ★空の箱を出さない。出すと「図が壊れた」のか「数字が無い」のか画面で見分けられない
  var NEED = {
    rank:'rows', stack:'bands', cal:'days', dumbbell:'rows', hist:'bins',
    funnel:'stages', pie:'slices', treemap:'cells', area:'series', slope:'rows', scatter:'pts'
  };

  //=== ★値を LOOP_DATA から引く。"@hist.points.last.value" のように書く。
  //===   こうしないと図の数字が「手で保守する写し」になり、次の計測で
  //===   上の大きい数字と下の図が食い違う（1.7.0 で実際に起きた）。
  //===   使える形: @a.b.c ／ 途中の last ＝配列の最後 ／ @a.b[].c ＝配列から c を集める
  function dig(o, path){
    var parts = path.split('.');
    for (var i = 0; i < parts.length; i++){
      if (o == null) return undefined;
      var p = parts[i], m = /^(\w+)\[\]$/.exec(p);
      if (p === 'last'){ o = o[o.length - 1]; continue; }
      if (m){
        var arr = o[m[1]];
        if (!arr || !arr.length) return undefined;
        var rest = parts.slice(i + 1).join('.');
        return arr.map(function(x){ return rest ? dig(x, rest) : x; });
      }
      o = o[p];
    }
    return o;
  }
  function deref(v){
    if (typeof v === 'string' && v.charAt(0) === '@'){
      var got = dig(DATA, v.slice(1));
      //=== 引けなかったら書いたとおりの文字を残す。黙って空にしない
      return got === undefined ? v : got;
    }
    if (Array.isArray(v)) return v.map(deref);
    if (v && typeof v === 'object'){
      var o = {};
      for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) o[k] = deref(v[k]);
      return o;
    }
    return v;
  }

  //=== ★作者が付けたクラス（rl-tight など）を描くたびに消さない。
  //===   className を 'rl rl-' + 型 で丸ごと上書きしていたので、rl-tight が一度も効いていなかった。
  //===   最初に見たクラスを覚えておき、そこに型のクラスを足す
  function setKind(el, t){
    if (el.getAttribute('data-rl-class') == null)
      el.setAttribute('data-rl-class', (el.getAttribute('class') || 'rl'));
    el.className = el.getAttribute('data-rl-class') + (t ? ' rl-' + t : '');
  }

  function drawViz(){
    document.querySelectorAll('.rl[data-rl]').forEach(function(el){
      var spec;
      try { spec = deref(JSON.parse(el.getAttribute('data-rl'))); }
      catch (e){
        //=== 黙って空にしない。JSON が壊れていることが画面で分かるようにする
        setKind(el, '');
        el.innerHTML = '<div class="rl-none">data-rl の JSON が読めません（' + esc(e.message) + '）</div>';
        return;
      }
      //=== ファネルだけは描き手が element に直接書く（SVG を実寸で描くため）
      if (spec && spec.t === 'funnel' && window.RL_FUNNEL){
        setKind(el, 'funnel');
        el.innerHTML = '';
        try { window.RL_FUNNEL(el, funnelSpec(spec)); }
        catch (err){ el.innerHTML = '<div class="rl-none">図を描けませんでした（' + esc(err.message) + '）</div>'; }
        return;
      }
      var f = KINDS[spec && spec.t];
      if (!f){
        setKind(el, '');
        el.innerHTML = '<div class="rl-none">知らない図です: ' + esc(spec && spec.t) + '</div>';
        return;
      }
      var need = NEED[spec.t];
      if (need && !(spec[need] && spec[need].length)){
        setKind(el, spec.t);
        el.innerHTML = (spec.title ? '<div class="rl-ttl">' + esc(spec.title) + '</div>' : '')
                     + '<div class="rl-none">まだ数字がありません</div>';
        return;
      }
      //=== ★1個が例外を投げても、残りの図は描く。
      //===   包まないと、壊れた data-rl が1つあるだけで頁じゅうの図が消える
      try {
        setKind(el, spec.t);
        el.innerHTML = f(spec);
        if (INTER[spec.t]) INTER[spec.t](el, spec);
        //=== ★一覧の行の中のブレットなら、行の帯の色と「はじめより」を同じ値から作る。
        //===   AI に百分率を計算させない（間違えるうえ、色の決まりが2か所に分かれる）
        var row = spec.t === 'bullet' && el.closest && el.closest('.loop-row');
        if (row){
          var tn = toneOf(spec);
          if (tn) row.setAttribute('data-tone', tn); else row.removeAttribute('data-tone');
          var dl = row.querySelector('.loop-delta');
          if (dl){ dl.textContent = deltaOf(spec); dl.className = 'loop-delta' + (tn ? ' ' + tn : ''); }
        }
      } catch (err){
        setKind(el, '');
        el.innerHTML = '<div class="rl-none">図を描けませんでした（' + esc(err.message) + '）</div>';
      }
    });
  }
  drawViz();
  (window.LOOP_REDRAWS = window.LOOP_REDRAWS || []).push(drawViz);
})();

