const _variant = (border, fill) => `
.box {
  border-style: solid;
  border-width: 10px 10px 10px 10px;
  background-color: #${fill};
  background-clip: padding-box;
  border-image: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="263.1" height="140.1" viewBox="0 0 246.7 131.3"><path fill="%23${fill}" stroke="%23${border}" stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M2.1 21.6c-.2 12.5 2 25 .9 37.4q-.5 12.3.1 24.4c0 12.7-.7 24.4.1 37.1 3.3 5.8 10.1 7.6 16 8.2 4.6 0 9.1-.7 13.7 0 6.8.8 14 1.4 20.8.7 8.3-.5 13.7-.1 22 0l7.2-.5L82.1 129c14.3-.7 28.6-.3 43-.4 14-.8 28.2 1 42.2-.6 13.3-1 26.7.2 40.1-.5 7.2-.7 14.4.2 21.6-.4 6.8-.5 11.8-.2 13.2-6q.3-7.3 1.2-14.5l0-.2q.5-10.5 1.4-21c.7-10.6-.4-21.2-.7-31.8q-1.1-20.2-1-40.6c1.7-7.4-4.3-12.8-11.5-11l-24.5 1.5c-6 .9-12-.1-18 .3-6.5-.4-13.1-1.6-19.6 0-10.7.5-21.3-1-32-.5-8.6.1-17.1 1-25.7 0h-5l-.2.1c-8.3-.1-16.6 0-24.9-1.3-11.5-.8-23 1.4-34.6 1.4q-12.2.3-24.4-.5c-6-.3-12-1.2-18-1.1-3.8 1.8-3 6.9-3 10.4q0 4.5.4 8.8"/></svg>') 10 10 10 10 stretch stretch;
}
`

const readClientCookie = (name) => {
  const prefix = `${name}=`
  const raw = document.cookie.split('; ').find((cookie) => cookie.startsWith(prefix))?.slice(prefix.length)
  if (!raw) return ''
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

globalThis.__discordUsername = readClientCookie('discord_username')
globalThis.__wowUsername = readClientCookie('wow_username')
globalThis.__setAuthState = (authenticated, wowUsername = '') => {
  const authValue = authenticated ? wowUsername || 'authenticated' : ''
  const root = document.documentElement
  root.style.setProperty('--auth-username', wowUsername ? JSON.stringify(wowUsername) : '""')
  if (authValue) root.dataset.auth = authValue
  else delete root.dataset.auth
  if (document.body) {
    if (authValue) document.body.dataset.auth = authValue
    else delete document.body.dataset.auth
  }
}
globalThis.__clearDiscordUsername = () => {
  document.cookie = 'discord_username=; Max-Age=0; Path=/; SameSite=Lax'
  document.cookie = 'wow_username=; Max-Age=0; Path=/; SameSite=Lax'
  globalThis.__discordUsername = ''
  globalThis.__wowUsername = ''
  globalThis.__setAuthState(false)
}
globalThis.__setAuthState(Boolean(globalThis.__discordUsername), globalThis.__wowUsername)
document.addEventListener('DOMContentLoaded', () => {
  globalThis.__setAuthState(Boolean(globalThis.__discordUsername), globalThis.__wowUsername)
}, { once: true })

const generateBoxVariant = (className, color, fill = color, size = 10) => {
  const isNone = fill === 'none'
  return `
.${className} {
  border-style: solid;
  background-color: ${isNone ? 'transparent' : '#' + fill};
  background-clip: padding-box;
  border-width: ${size}px;
  border-radius: ${size + 2}px;
  border-image: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="263.1" height="140.1" viewBox="0 0 246.7 131.3"><path fill="${
    isNone ? 'none' : '%23' + fill
  }" stroke="%23${color}" stroke-linecap="round" stroke-linejoin="round" stroke-width="${
    size / 3
  }" d="M2.1 21.6c-.2 12.5 2 25 .9 37.4q-.5 12.3.1 24.4c0 12.7-.7 24.4.1 37.1 3.3 5.8 10.1 7.6 16 8.2 4.6 0 9.1-.7 13.7 0 6.8.8 14 1.4 20.8.7 8.3-.5 13.7-.1 22 0l7.2-.5L82.1 129c14.3-.7 28.6-.3 43-.4 14-.8 28.2 1 42.2-.6 13.3-1 26.7.2 40.1-.5 7.2-.7 14.4.2 21.6-.4 6.8-.5 11.8-.2 13.2-6q.3-7.3 1.2-14.5l0-.2q.5-10.5 1.4-21c.7-10.6-.4-21.2-.7-31.8q-1.1-20.2-1-40.6c1.7-7.4-4.3-12.8-11.5-11l-24.5 1.5c-6 .9-12-.1-18 .3-6.5-.4-13.1-1.6-19.6 0-10.7.5-21.3-1-32-.5-8.6.1-17.1 1-25.7 0h-5l-.2.1c-8.3-.1-16.6 0-24.9-1.3-11.5-.8-23 1.4-34.6 1.4q-12.2.3-24.4-.5c-6-.3-12-1.2-18-1.1-3.8 1.8-3 6.9-3 10.4q0 4.5.4 8.8"/></svg>') ${size} stretch;
}
`
}

const generateBoxVariantMulti = (selectors, color, fill = color, size = 10) => {
  const isNone = fill === 'none'
  const selectorStr = Array.isArray(selectors) ? selectors.join(', ') : selectors
  return `
${selectorStr} {
  border-style: solid;
  background-color: ${isNone ? 'transparent' : '#' + fill};
  background-clip: padding-box;
  border-width: ${size}px;
  border-radius: ${size + 2}px;
  border-image: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="263.1" height="140.1" viewBox="0 0 246.7 131.3"><path fill="${
    isNone ? 'none' : '%23' + fill
  }" stroke="%23${color}" stroke-linecap="round" stroke-linejoin="round" stroke-width="${
    size / 3
  }" d="M2.1 21.6c-.2 12.5 2 25 .9 37.4q-.5 12.3.1 24.4c0 12.7-.7 24.4.1 37.1 3.3 5.8 10.1 7.6 16 8.2 4.6 0 9.1-.7 13.7 0 6.8.8 14 1.4 20.8.7 8.3-.5 13.7-.1 22 0l7.2-.5L82.1 129c14.3-.7 28.6-.3 43-.4 14-.8 28.2 1 42.2-.6 13.3-1 26.7.2 40.1-.5 7.2-.7 14.4.2 21.6-.4 6.8-.5 11.8-.2 13.2-6q.3-7.3 1.2-14.5l0-.2q.5-10.5 1.4-21c.7-10.6-.4-21.2-.7-31.8q-1.1-20.2-1-40.6c1.7-7.4-4.3-12.8-11.5-11l-24.5 1.5c-6 .9-12-.1-18 .3-6.5-.4-13.1-1.6-19.6 0-10.7.5-21.3-1-32-.5-8.6.1-17.1 1-25.7 0h-5l-.2.1c-8.3-.1-16.6 0-24.9-1.3-11.5-.8-23 1.4-34.6 1.4q-12.2.3-24.4-.5c-6-.3-12-1.2-18-1.1-3.8 1.8-3 6.9-3 10.4q0 4.5.4 8.8"/></svg>') ${size} stretch;
}
`
}

// Programmatic color resolver for CSS variables (converting hex/rgb/rgba to url-compatible hex values)
const parseColorToHex = (colorVal) => {
  if (!colorVal) return 'none'
  colorVal = colorVal.trim()
  if (colorVal.startsWith('#')) {
    return colorVal.slice(1)
  }
  if (colorVal.startsWith('rgba') || colorVal.startsWith('rgb')) {
    const match = colorVal.match(/\d+(\.\d+)?/g)
    if (match) {
      const r = parseInt(match[0], 10)
      const g = parseInt(match[1], 10)
      const b = parseInt(match[2], 10)
      const a = match[3] ? parseFloat(match[3]) : 1

      if (a === 0) return 'none'

      const toHex = (c) => c.toString(16).padStart(2, '0')
      if (a < 1) {
        const alphaHex = Math.round(a * 255).toString(16).padStart(2, '0')
        return `${toHex(r)}${toHex(g)}${toHex(b)}${alphaHex}`
      }
      return `${toHex(r)}${toHex(g)}${toHex(b)}`
    }
  }
  if (colorVal === 'transparent') return 'none'
  return colorVal
}

const getCSSVar = (name) => {
  const val = getComputedStyle(document.documentElement).getPropertyValue(name)
  return val ? val.trim() : ''
}

// Generate styles dynamically using actual theme CSS variables
const bgColor = parseColorToHex(getCSSVar('--bg-color'))
const cardBg = parseColorToHex(getCSSVar('--card-bg'))
const accentColor = parseColorToHex(getCSSVar('--accent-color'))
const accentHover = parseColorToHex(getCSSVar('--accent-hover'))
const discordColor = parseColorToHex(getCSSVar('--discord-color'))
const discordHover = parseColorToHex(getCSSVar('--discord-hover'))
const dangerButtonBg = parseColorToHex(getCSSVar('--danger-button-bg'))
const dangerColor = parseColorToHex(getCSSVar('--danger-color'))
const dangerBg = parseColorToHex(getCSSVar('--danger-bg'))
const successColor = parseColorToHex(getCSSVar('--success-color'))
const successBg = parseColorToHex(getCSSVar('--success-bg'))
const surface = parseColorToHex(getCSSVar('--surface'))
const surface2 = parseColorToHex(getCSSVar('--surface2'))
const textSecondary = parseColorToHex(getCSSVar('--text-secondary'))
const textMuted = parseColorToHex(getCSSVar('--text-muted'))
const borderColor = parseColorToHex(getCSSVar('--border-color'))

const styleEl = document.createElement('style')
styleEl.innerHTML = `
  /* Main card container */
  ${generateBoxVariant('container', cardBg, cardBg, 12)}

  /* Buttons */
  ${generateBoxVariant('btn-primary', '000000', accentColor, 10)}
  ${generateBoxVariant('btn-primary:hover', '000000', accentHover, 10)}
  ${generateBoxVariant('btn-discord', 'ffffff', discordColor, 10)}
  ${generateBoxVariant('btn-discord:hover', 'ffffff', discordHover, 10)}
  ${generateBoxVariant('btn-secondary', textSecondary, surface, 8)}
  ${generateBoxVariant('btn-secondary:hover', accentColor, surface2, 8)}
  ${generateBoxVariant('btn-danger', dangerColor, dangerButtonBg, 10)}
  ${generateBoxVariant('btn-danger:hover', dangerColor, dangerColor, 10)}
  ${generateBoxVariant('btn-ghost', textMuted, 'none', 8)}
  ${generateBoxVariant('btn-ghost:hover', accentColor, surface2, 8)}
  ${generateBoxVariant('btn-nav', textMuted, surface2, 8)}
  ${generateBoxVariant('btn-nav:hover', accentColor, surface2, 8)}

  /* Inputs and Select boxes */
  ${
  generateBoxVariantMulti(
    ['input[type="text"]', 'input[type="password"]', 'select'],
    borderColor || 'ffffff14',
    '00000033',
    8,
  )
}
  ${
  generateBoxVariantMulti(
    ['input[type="text"]:focus', 'input[type="password"]:focus', 'select:focus'],
    accentColor,
    '00000033',
    8,
  )
}

  /* Leaderboard selects */
  ${generateBoxVariantMulti('.leaderboard-controls select', borderColor || 'ffffff14', surface2, 8)}
  ${generateBoxVariantMulti('.leaderboard-controls select:focus', accentColor, surface2, 8)}

  /* Status Banners */
  ${generateBoxVariant('status-success', successColor, successBg, 10)}
  ${generateBoxVariant('status-error', dangerColor, dangerBg, 10)}

  /* Wrapper layouts & Table wraps & logs */
  ${generateBoxVariant('char-table-wrapper', surface, surface, 10)}
  ${generateBoxVariant('leaderboard-table-wrapper', surface, surface, 10)}
  ${generateBoxVariant('table-wrap', surface, surface, 10)}
  ${generateBoxVariant('box', surface, surface, 10)}
  ${generateBoxVariant('log-box', borderColor || 'ffffff14', bgColor, 10)}

  /* White/Black box fallbacks */
  ${generateBoxVariant('white-box', 'ffffff', 'none', 8)}
  ${generateBoxVariant('black-box', '000000', 'none', 10)}


`
document.head.appendChild(styleEl)

const navigationState = {
  controller: null,
  href: '',
}

const navigationPage = (url) => {
  if (url.pathname === '/account') return 'account'
  if (url.pathname === '/install') return 'install'
  if (url.pathname === '/about' || url.pathname === '/about.html') return 'about'
  if (url.pathname === '/leaderboards' || url.pathname === '/') return 'leaderboards'
  return ''
}

const updateSiteNavigation = (url = new URL(location.href)) => {
  const page = navigationPage(url)
  for (const link of document.querySelectorAll('#siteNavigation [data-nav-page]')) {
    const active = link.dataset.navPage === page
    link.classList.toggle('active', active)
    if (active) link.setAttribute('aria-current', 'page')
    else link.removeAttribute('aria-current')
  }
}

const setupSiteNavigation = () => {
  updateSiteNavigation()
  const nameElement = document.getElementById('siteNavAccountName')
  if (globalThis.__discordUsername) nameElement.textContent = globalThis.__discordUsername

  fetch('/api/account', { credentials: 'include' })
    .then((response) => response.json())
    .then((data) => {
      if (!data.authenticated) {
        globalThis.__clearDiscordUsername()
        nameElement.textContent = 'Register or Login'
        return
      }
      const name = data.user.username || data.user.global_name
      const avatar = document.getElementById('siteNavAccountAvatar')
      nameElement.textContent = name
      avatar.src = data.user.avatar
        ? `https://cdn.discordapp.com/avatars/${data.user.id}/${data.user.avatar}.png`
        : 'https://cdn.discordapp.com/embed/avatars/0.png'
      avatar.alt = `${name} avatar`
    })
    .catch(() => {})
}

const navigationExcludedPaths = new Set([
  '/auth/discord/login',
  '/auth/discord/callback',
])

const pageHref = (url) => `${url.origin}${url.pathname.replace(/\/$/, '') || '/'}`

const setNavigationProgress = (progress) => {
  const container = document.getElementById('topLoadingBarContainer')
  const path = document.getElementById('topLoadingPath')
  const master = document.getElementById('handDrawnBorderPath')
  if (!container || !path || !master) return

  const length = master.getTotalLength() || 750
  path.style.strokeDasharray = length
  path.style.strokeDashoffset = length * (1 - Math.max(0, Math.min(1, progress)))
  container.classList.toggle('is-loading', progress < 1)
  container.classList.toggle('is-complete', progress >= 1)
}

const startNavigationProgress = () => {
  const container = document.getElementById('topLoadingBarContainer')
  const path = document.getElementById('topLoadingPath')
  container?.classList.add('is-loading')
  container?.classList.remove('is-complete')
  if (path) path.style.transition = 'none'
  setNavigationProgress(0)
  path?.getBoundingClientRect()
  if (path) path.style.transition = ''
}

const finishNavigationProgress = () => {
  setNavigationProgress(1)
  setTimeout(() => {
    document.getElementById('topLoadingBarContainer')?.classList.remove('is-loading', 'is-complete')
  }, 180)
}

const readNavigationResponse = async (response, onProgress) => {
  if (!response.body) return response.text()

  const total = Number(response.headers.get('content-length') || 0)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const chunks = []
  let loaded = 0
  let unknownProgress = 0.04

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    loaded += value.byteLength
    unknownProgress = Math.min(0.9, unknownProgress + 0.04)
    onProgress(total > 0 ? loaded / total : unknownProgress)
  }

  return decoder.decode(
    chunks.reduce((result, chunk) => {
      const next = new Uint8Array(result.length + chunk.length)
      next.set(result)
      next.set(chunk, result.length)
      return next
    }, new Uint8Array()),
  )
}

const updatePageStyles = (doc) => {
  const source = doc.head.querySelector('style[data-page-style]')
  let target = document.head.querySelector('style[data-page-style]')
  if (!source) {
    target?.remove()
    return
  }
  if (!target) {
    target = document.createElement('style')
    target.dataset.pageStyle = ''
    document.head.appendChild(target)
  }
  target.textContent = source.textContent
}

const runPageScript = (doc) => {
  const source = doc.querySelector('script[data-page-script]')
  if (!source) return
  const script = document.createElement('script')
  script.type = 'module'
  script.textContent = source.textContent
  document.body.appendChild(script)
}

const swapPageContent = (doc) => {
  const current = document.getElementById('page-content')
  const next = doc.getElementById('page-content')
  if (!current || !next) throw new Error('Navigation response has no page content')

  document.title = doc.title
  updatePageStyles(doc)

  for (const attribute of [...current.attributes]) {
    if (attribute.name !== 'id') current.removeAttribute(attribute.name)
  }
  for (const attribute of [...next.attributes]) {
    if (attribute.name !== 'id') current.setAttribute(attribute.name, attribute.value)
  }

  current.innerHTML = next.innerHTML
  current.scrollTop = 0
  globalThis.scrollTo(0, 0)
  updateSiteNavigation(new URL(location.href))
  current.classList.add('navigation-enter')
  requestAnimationFrame(() => current.classList.remove('navigation-enter'))
  runPageScript(doc)
}

const loadPage = async (url, signal) => {
  startNavigationProgress()
  const current = document.getElementById('page-content')
  current?.classList.add('navigation-exit')

  try {
    const response = await fetch(url.href, { signal })
    if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
      throw new Error(`Navigation failed with status ${response.status}`)
    }
    if (pageHref(new URL(response.url)) !== pageHref(url)) {
      throw new Error('Navigation was redirected')
    }

    const html = await readNavigationResponse(response, setNavigationProgress)
    if (signal?.aborted) return
    const doc = new DOMParser().parseFromString(html, 'text/html')
    current?.classList.remove('navigation-exit')
    swapPageContent(doc)
  } finally {
    if (!signal?.aborted) finishNavigationProgress()
  }
}

const isNavigableLink = (event, link) => {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.altKey ||
    event.ctrlKey ||
    event.shiftKey ||
    !link ||
    link.target ||
    link.download
  ) return false

  const url = new URL(link.href)
  return url.origin === location.origin && !url.hash && !navigationExcludedPaths.has(url.pathname) &&
    pageHref(url) !== pageHref(location)
}

const navigateWithoutNavigationApi = (url) => {
  navigationState.controller?.abort()
  navigationState.controller = new AbortController()
  navigationState.href = pageHref(url)
  history.pushState({}, '', url.href)
  updateSiteNavigation(url)
  loadPage(url, navigationState.controller.signal)
    .catch(() => {
      if (!navigationState.controller?.signal.aborted) location.href = url.href
    })
    .finally(() => {
      if (navigationState.href === pageHref(url)) navigationState.href = ''
    })
}

const shouldInterceptNavigationEvent = (event) => {
  if (!event.canIntercept || event.downloadRequest || event.hashChange || event.formData) return false
  const url = new URL(event.destination.url)
  return url.origin === location.origin && !navigationExcludedPaths.has(url.pathname) &&
    pageHref(url) !== pageHref(location)
}

const setupSPAClientNavigation = () => {
  if (globalThis.__spaNavigationReady) return
  globalThis.__spaNavigationReady = true

  const navigationApi = globalThis.navigation
  if (navigationApi) {
    navigationApi.addEventListener('navigate', (event) => {
      if (!shouldInterceptNavigationEvent(event)) return
      const url = new URL(event.destination.url)
      if (navigationState.href === pageHref(url)) {
        event.preventDefault()
        return
      }

      updateSiteNavigation(url)
      event.intercept({
        async handler() {
          navigationState.href = pageHref(url)
          try {
            await loadPage(url, event.signal)
          } catch (error) {
            if (event.signal.aborted || error.name === 'AbortError') return
            location.href = url.href
          } finally {
            if (navigationState.href === pageHref(url)) navigationState.href = ''
          }
        },
      })
    })
    return
  }

  document.addEventListener('click', (event) => {
    const link = event.target.closest?.('a[href]')
    if (!isNavigableLink(event, link)) return
    event.preventDefault()
    navigateWithoutNavigationApi(new URL(link.href))
  })
  globalThis.addEventListener('popstate', () => {
    navigationState.controller?.abort()
    navigationState.controller = new AbortController()
    updateSiteNavigation(new URL(location.href))
    loadPage(new URL(location.href), navigationState.controller.signal).catch(() => location.reload())
  })
}

document.addEventListener('DOMContentLoaded', () => {
  setupSiteNavigation()
  setupSPAClientNavigation()
}, { once: true })
