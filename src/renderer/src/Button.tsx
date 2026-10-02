// アプリの画面で使うボタンの共通部品。押せることが分かるように、カーソル・マウスを乗せたとき・押しているあいだ・
// キーボードで選んだとき・押せないときの見た目をそろえる（見た目は style.css の .btn）
import type { ButtonHTMLAttributes } from 'react'

export type ButtonVariant =
  /** いちばん押してほしい操作（青で塗る） */
  | 'primary'
  /** そのほかの操作（白地に枠） */
  | 'secondary'
  /** 取り消せない・外す操作（赤い枠） */
  | 'danger'
  /** 赤で塗る（直っていない所があるときの主な操作） */
  | 'danger-solid'
  /** 黒で塗る（ループの画面の上のカードの主な操作） */
  | 'dark'
  /** 文字だけの控えめな操作（✕・＋ など） */
  | 'quiet'
  /** 濃いタブの列の上の操作（色を持たない。オンのときだけ白く塗る） */
  | 'bar'

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'md' | 'sm' }) {
  return <button type={type} className={`btn btn-${variant} btn-${size} ${className}`.trim()} {...rest} />
}
