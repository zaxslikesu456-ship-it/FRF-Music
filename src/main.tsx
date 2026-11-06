import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { upgradeStoredCovers } from './utils/cover'
import { finishPendingWipe } from './utils/wipeData'

const root = createRoot(document.getElementById('root')!)

// A "Clear all data" started last session is finished before anything reads
// storage, so nothing the old session wrote on its way out survives.
finishPendingWipe()
  .catch(() => {})
  .then(start)

function start() {
  upgradeStoredCovers()

  if (new URLSearchParams(window.location.search).get('mini') === '1') {
    // PC always-on-top mini player: a tiny view, none of the app contexts.
    Promise.all([import('./components/PcMiniWindow'), import('./utils/imageFallback')]).then(
      ([{ PcMiniWindow }, { installImageFallback }]) => {
        installImageFallback()
        root.render(<PcMiniWindow />)
      },
    )
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
}
