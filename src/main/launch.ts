// claude / codex を起動するときの引数。OS によらない部分だけを置く（探し方と起動は platform.ts）。

/** claude に渡す起動時の指示。--plugin-dir だけでは ~/.claude/skills の rising-loop が呼ばれるため（2026-10-01 に確かめた） */
export const CLAUDE_PROMPT = `rising-loop のスキルは、プラグインの rising-loop:rising-loop を使う。~/.claude/skills などほかの場所にある rising-loop は使わない。「/rising-loop を呼び出して」と言われたら rising-loop:rising-loop を呼ぶ。
この会話は Rising Loop の右のチャットとして動いている。
画面（loops/）はアプリが、書き終わるのを待って自動で読み込み直す。ユーザーに「画面を再読み込みしてください」と頼まない（画面に再読み込みのボタンは無い）。`

/** ループが無いプロジェクトで、最初にチャットへ送る依頼。claude と codex のどちらにも通じるよう、スラッシュコマンドにしない */
export const KICKOFF = 'rising-loop を始めます。まず /rising-loop を呼び出して最新の手順を読み、それに従ってください。'

/**
 * そのチャットの担当（起動時の指示の最後に足す）。チャットは画面ごとに1つずつあり、ユーザーはその画面を見ながら話す。
 * ボタンから来る指示文には loop: があるが、ユーザーが直接打った文には無いので、どの画面のチャットかを AI に教えておく
 */
export function chatScope(screen: string): string {
  const id = screen.replace(/^s-/, '')
  if (screen === 's-list')
    return `# このチャットの担当: ループ一覧（loops/index.html）
- このチャットは、Rising Loop の一覧の画面の右に出ている。ユーザーは一覧を見ながら話している。
- 受け持つのは、一覧の画面（ヘッダ・主要な数字・ループの行）、ループの追加、全ループ更新、プロジェクト全体の話。
- 指示の先頭に loop: が無いとき（ユーザーが直接打った文など）は、一覧かプロジェクト全体についての話として扱う。
- 1つのループの頁（loops/LXX.html）の中身だけを直す話は、そのループの頁の右のチャットのほうが向いている。ただし /rising-loop の手順（全ループ更新・ループの追加など）がここから各ループの頁を直すように言うときは、その手順に従う。`
  return `# このチャットの担当: ループ ${id}（loops/${id}.html）
- このチャットは、Rising Loop の画面「${id}」の右に出ている。ユーザーは ${id} の頁を見ながら話している。
- 指示の先頭に loop: が無いとき（ユーザーが直接打った文など）は、${id} についての話として扱う。「この数字」「このグラフ」「この施策」は ${id} の頁の中のもの。
- 直してよいのは ${id} のものだけ: loops/${id}.html、loops/update/${id}.py、loops/logs/${id}.md。
- ほかのループの頁（loops/LXX.html）と一覧（loops/index.html）は直さない。ほかのループや一覧の話が来たら、その画面の右のチャットで頼むよう、ひとことで伝える。
- ただし /rising-loop の手順が、このループの作業の一部として一覧（loops/index.html）の ${id} の行などを直すように言うときは、その手順に従う。`
}

/** claude の起動時の指示（--append-system-prompt-file に書く）。共通の指示のあとに、そのチャットの担当 */
export function claudePrompt(screen: string): string {
  return CLAUDE_PROMPT + '\n\n' + chatScope(screen)
}

/** codex にはスキルの場所を足す手段が無いので、起動時の指示で場所を伝える。screen があれば、そのチャットの担当も足す */
export function codexInstructions(skillDir: string, screen?: string): string {
  return codexBase(skillDir) + (screen ? '\n\n' + chatScope(screen) : '')
}

function codexBase(skillDir: string): string {
  return `rising-loop のスキルは ${skillDir} にある。「/rising-loop を呼び出して」と言われたら、まずこのフォルダの SKILL.md を読んで従う。同じフォルダの references/ と assets/ もこのスキルの一部。SKILL.md などに出てくる <スキル> は、このフォルダのこと。ほかの場所にある rising-loop は使わない。
この会話は Rising Loop の右のチャットとして動いている。
画面（loops/）はアプリが、書き終わるのを待って自動で読み込み直す。ユーザーに「画面を再読み込みしてください」と頼まない（画面に再読み込みのボタンは無い）。`
}

export interface ClaudeLaunch {
  sessionId: string
  /** 会話のファイルがすでにあるか（あれば --resume、無ければ --session-id で始める） */
  exists: boolean
  pluginDir: string
  promptFile: string
  /** ~/.claude/settings.json の model。--resume は会話に残ったモデルを優先するので、明示してそろえる */
  model: string | null
  /**
   * 会話を始めるときに送る文。貼り付けると、起動直後でまだ入力を受け付けない claude に捨てられるので、起動時の引数で渡す
   * （2026-10-02 に本物の claude で、起動から約1秒の貼り付けが捨てられるのを確かめた）
   */
  prompt?: string
  /** コマンド実行の確認を「すべて自動で許可」にする */
  autoApprove?: boolean
}

export function claudeArgs(o: ClaudeLaunch): string[] {
  return [
    ...(o.exists ? ['--resume', o.sessionId] : ['--session-id', o.sessionId]),
    '--plugin-dir', o.pluginDir,
    // Claude Code 自身の「Anthropic へのフィードバック」を使わせない。「アプリのフィードバック」と言われて、英語の送信画面を出してしまう
    // （2026-10-08 に本物の claude で起きた）。アプリへのご意見は、スキルの「開発者に送る」（loops/.feedback）で受ける
    '--disallowedTools', 'SendFeedback',
    // 指示はファイルで渡す（Windows で長い日本語を引数に載せると壊れやすい）
    '--append-system-prompt-file', o.promptFile,
    // chat-pane.sh と同じ。右のチャットは長く続くので、20万トークンを超えたら要約させる
    '--autocompact', '200000',
    ...(o.model ? ['--model', o.model] : []),
    ...(o.autoApprove ? ['--permission-mode', 'bypassPermissions'] : []),
    // -- のあとは文として読ませる（指示文は --- で始まるので、オプションと間違えられる）
    ...(o.prompt ? ['--', o.prompt] : [])
  ]
}

/** -c の値は TOML として読まれる。JSON の文字列は TOML の基本文字列としても読める（\\ と " を壊さない） */
const devInstructions = (text: string) => ['-c', 'developer_instructions=' + JSON.stringify(text)]

export function codexArgs(o: { threadId: string; instructions: string; prompt?: string; autoApprove?: boolean }): string[] {
  return [
    ...devInstructions(o.instructions),
    ...(o.autoApprove ? ['--dangerously-bypass-approvals-and-sandbox'] : []),
    'resume',
    o.threadId,
    ...(o.prompt ? ['--', o.prompt] : [])
  ]
}

export function codexCreateArgs(o: { instructions: string; prompt: string }): string[] {
  return [...devInstructions(o.instructions), 'exec', '--json', '--skip-git-repo-check', o.prompt]
}

export function parseCodexThreadId(jsonl: string): string | null {
  for (const line of jsonl.split(/\r?\n/)) {
    try {
      const ev = JSON.parse(line)
      if (ev?.type === 'thread.started' && typeof ev.thread_id === 'string') return ev.thread_id
    } catch {
      // JSON でない行は読み飛ばす
    }
  }
  return null
}
