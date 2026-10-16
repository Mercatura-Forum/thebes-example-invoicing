import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ready } from '@thebes/sdk'
import './index.css'
import { App } from './App'

const root = createRoot(document.getElementById('root')!)
const render = () =>
  root.render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// This browser's signing key (made on a first visit, kept after) is loaded before
// the first render, because pages read identity() while rendering. A browser that
// cannot sign still gets the page; its calls then fail with a named error.
ready().then(render, render)
