import { createRoot } from 'react-dom/client'
import { App } from './App'
import { Overlay } from './Overlay'
import './style.css'

// ?overlay=bar は、ループの画面の上に重ねる透明な層（カードだけを描く）
const overlay = new URLSearchParams(location.search).get('overlay') === 'bar'
if (overlay) document.body.classList.add('overlay')
createRoot(document.getElementById('root')!).render(overlay ? <Overlay /> : <App />)
