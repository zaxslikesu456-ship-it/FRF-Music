import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

const root = createRoot(document.getElementById('root')!)

if (new URLSearchParams(window.location.search).get('mini') === '1') {
  // PC always-on-top mini player: a tiny view, none of the app contexts.
  import('./components/PcMiniWindow').then(({ PcMiniWindow }) => {
    root.render(<PcMiniWindow />)
  })
} else {
  Promise.all([import('./App.tsx'), import('./utils/imageFallback')]).then(
    ([{ default: App }, { installImageFallback }]) => {
      installImageFallback()
      root.render(
        <StrictMode>
          <App />
        </StrictMode>,
      )
    },
  )
}
