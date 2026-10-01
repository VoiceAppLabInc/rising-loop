// claude / codex を起動するときの引数。OS によらない部分だけを置く（探し方と起動は platform.ts）。

/** claude に渡す起動時の指示。--plugin-dir だけでは ~/.claude/skills の rising-loop が呼ばれるため（2026-10-01 に確かめた） */
export const CLAUDE_PROMPT = `rising-loop のスキルは、プラグインの rising-loop:rising-loop を使う。~/.claude/skills などほかの場所にある rising-loop は使わない。「/rising-loop を呼び出して」と言われたら rising-loop:rising-loop を呼ぶ。
この会話は Rising Loop App の右のチャットとして動いている。`

/** ループが無いプロジェクトで、最初にチャットへ送る依頼。claude と codex のどちらにも通じるよう、スラッシュコマンドにしない */
export const KICKOFF = 'rising-loop を始めます。まず /rising-loop を呼び出して最新の手順を読み、それに従ってください。'

/** codex にはスキルの場所を足す手段が無いので、起動時の指示で場所を伝える */
export function codexInstructions(skillDir: string): string {
  return `rising-loop のスキルは ${skillDir} にある。「/rising-loop を呼び出して」と言われたら、まずこのフォルダの SKILL.md を読んで従う。同じフォルダの references/ と assets/ もこのスキルの一部。SKILL.md などに出てくる <スキル> は、このフォルダのこと。ほかの場所にある rising-loop は使わない。
この会話は Rising Loop App の右のチャットとして動いている。`
}

export interface ClaudeLaunch {
  sessionId: string
  /** 会話のファイルがすでにあるか（あれば --resume、無ければ --session-id で始める） */
  exists: boolean
  pluginDir: string
  promptFile: string
  /** ~/.claude/settings.json の model。--resume は会話に残ったモデルを優先するので、明示してそろえる */
  model: string | null
}

export function claudeArgs(o: ClaudeLaunch): string[] {
  return [
    ...(o.exists ? ['--resume', o.sessionId] : ['--session-id', o.sessionId]),
    '--plugin-dir', o.pluginDir,
    // 指示はファイルで渡す（Windows で長い日本語を引数に載せると壊れやすい）
    '--append-system-prompt-file', o.promptFile,
    // chat-pane.sh と同じ。右のチャットは長く続くので、20万トークンを超えたら要約させる
    '--autocompact', '200000',
    ...(o.model ? ['--model', o.model] : [])
  ]
}

/** -c の値は TOML として読まれる。JSON の文字列は TOML の基本文字列としても読める（\\ と " を壊さない） */
const devInstructions = (text: string) => ['-c', 'developer_instructions=' + JSON.stringify(text)]

export function codexArgs(o: { threadId: string; instructions: string }): string[] {
  return [...devInstructions(o.instructions), 'resume', o.threadId]
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
