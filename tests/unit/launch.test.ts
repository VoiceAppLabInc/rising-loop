import { describe, expect, it } from 'vitest'
import { CLAUDE_PROMPT, chatScope, claudeArgs, claudePrompt, codexArgs, codexCreateArgs, codexInstructions, parseCodexThreadId } from '../../src/main/launch'

describe('claudeArgs', () => {
  const base = { pluginDir: '/app/skill', promptFile: '/data/claude-prompt.md', model: null }

  it('会話のファイルがあれば続きから開く', () => {
    expect(claudeArgs({ ...base, sessionId: 'abc', exists: true })).toEqual([
      '--resume', 'abc',
      '--plugin-dir', '/app/skill',
      '--append-system-prompt-file', '/data/claude-prompt.md',
      '--autocompact', '200000'
    ])
  })

  it('会話のファイルが無ければ、その ID で新しく始める', () => {
    expect(claudeArgs({ ...base, sessionId: 'abc', exists: false }).slice(0, 2)).toEqual(['--session-id', 'abc'])
  })

  it('設定の model があれば渡す（--resume は会話に残ったモデルを優先するため）', () => {
    expect(claudeArgs({ ...base, sessionId: 'abc', exists: true, model: 'opus' }).slice(-2)).toEqual(['--model', 'opus'])
  })
})

describe('codex', () => {
  it('起動時の指示は TOML の文字列として渡す（Windows のパスの \\ と引用符を壊さない）', () => {
    const text = codexInstructions('C:\\Program Files\\Rising Loop\\skill\\skills\\rising-loop')
    const [flag, kv] = codexArgs({ threadId: 't1', instructions: text }).slice(0, 2)
    expect(flag).toBe('-c')
    expect(kv.startsWith('developer_instructions="')).toBe(true)
    expect(JSON.parse(kv.slice('developer_instructions='.length))).toBe(text)
    expect(text).toContain('C:\\Program Files\\Rising Loop\\skill\\skills\\rising-loop')
  })

  it('続きから開く', () => {
    expect(codexArgs({ threadId: 't1', instructions: 'x' }).slice(2)).toEqual(['resume', 't1'])
  })

  it('新しい会話は exec で作って ID を受け取る', () => {
    const a = codexCreateArgs({ instructions: 'x', prompt: 'はじめ' })
    expect(a.slice(0, 2)).toEqual(['-c', 'developer_instructions="x"'])
    expect(a.slice(2)).toEqual(['exec', '--json', '--skip-git-repo-check', 'はじめ'])
  })

  it('exec の出力から会話の ID を取り出す', () => {
    const out = '{"type":"thread.started","thread_id":"0199-abc"}\n{"type":"turn.started"}\n'
    expect(parseCodexThreadId(out)).toBe('0199-abc')
    expect(parseCodexThreadId('{"type":"error"}\nnot json\n')).toBeNull()
  })
})

describe('codexInstructions', () => {
  it('SKILL.md の <スキル> がどこを指すかを伝える', () => {
    expect(codexInstructions('/app/skill/skills/rising-loop')).toContain('<スキル> は、このフォルダのこと')
  })
})

describe('起動時の指示', () => {
  it('claude にも codex にも、画面の再読み込みを頼まないと伝える（古い会話の決まりを打ち消す）', () => {
    expect(CLAUDE_PROMPT).toContain('「画面を再読み込みしてください」と頼まない')
    expect(codexInstructions('/x')).toContain('「画面を再読み込みしてください」と頼まない')
  })
})

describe('会話を始めるときに送る文（起動時の引数で渡す）', () => {
  const base = { sessionId: 'abc', exists: false, pluginDir: '/p', promptFile: '/f', model: null }
  it('claude は、いちばん最後に -- を挟んで渡す（--- で始まる文をオプションと間違えさせない）', () => {
    const a = claudeArgs({ ...base, prompt: '---\nloop: all\n---' })
    expect(a.slice(-2)).toEqual(['--', '---\nloop: all\n---'])
  })
  it('文が無ければ渡さない', () => {
    expect(claudeArgs(base)).not.toContain('--')
  })
  it('codex は resume <ID> のあとに -- を挟んで渡す', () => {
    expect(codexArgs({ threadId: 't1', instructions: 'x', prompt: '---\na\n---' }).slice(2)).toEqual(['resume', 't1', '--', '---\na\n---'])
  })
})

describe('コマンド実行の確認のモード', () => {
  const base = { sessionId: 'abc', exists: false, pluginDir: '/p', promptFile: '/f', model: null }
  it('すべて自動で許可：claude は bypassPermissions で起動する', () => {
    const a = claudeArgs({ ...base, autoApprove: true, prompt: 'x' })
    expect(a).toContain('--permission-mode')
    expect(a[a.indexOf('--permission-mode') + 1]).toBe('bypassPermissions')
    expect(a.slice(-2)).toEqual(['--', 'x'])
  })
  it('確認する：何も足さない（使う人の設定のまま）', () => {
    expect(claudeArgs(base)).not.toContain('--permission-mode')
    expect(codexArgs({ threadId: 't', instructions: 'x' })).not.toContain('--dangerously-bypass-approvals-and-sandbox')
  })
  it('すべて自動で許可：codex は確認も囲いも外して起動する', () => {
    const a = codexArgs({ threadId: 't', instructions: 'x', autoApprove: true })
    expect(a.indexOf('--dangerously-bypass-approvals-and-sandbox')).toBeLessThan(a.indexOf('resume'))
  })
})

describe('chatScope（そのチャットの担当）', () => {
  it('ループのチャットは、そのループの頁が担当で、loop: の無い話はそのループの話として扱う', () => {
    const s = chatScope('s-L03')
    expect(s).toContain('ループ L03')
    expect(s).toContain('loops/L03.html')
    expect(s).toContain('loop: が無い')
    expect(s).toContain('ほかのループの頁（loops/LXX.html）と一覧（loops/index.html）は直さない')
    // 手順書の指示が担当の決まりと食い違うときは、手順書を優先する
    expect(s).toContain('/rising-loop の手順')
  })
  it('一覧のチャットは、一覧・ループの追加・全ループ更新・プロジェクト全体の担当', () => {
    const s = chatScope('s-list')
    expect(s).toContain('ループ一覧')
    expect(s).toContain('loops/index.html')
    expect(s).toContain('ループの追加')
    expect(s).toContain('全ループ更新')
  })
  it('起動時の指示は、共通の指示のあとに担当を足したもの（claude・codex とも）', () => {
    expect(claudePrompt('s-L03')).toBe(CLAUDE_PROMPT + '\n\n' + chatScope('s-L03'))
    expect(codexInstructions('/x', 's-L03')).toContain(chatScope('s-L03'))
    expect(codexInstructions('/x')).not.toContain('このチャットの担当')
  })
})
