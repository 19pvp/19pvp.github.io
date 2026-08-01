const variant = (border, fill) => `
.box {
  border-style: solid;
  border-width: 10px 10px 10px 10px;
  background-color: #${fill};
  background-clip: padding-box;
  border-image: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="263.1" height="140.1" viewBox="0 0 246.7 131.3"><path fill="%23${fill}" stroke="%23${border}" stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M2.1 21.6c-.2 12.5 2 25 .9 37.4q-.5 12.3.1 24.4c0 12.7-.7 24.4.1 37.1 3.3 5.8 10.1 7.6 16 8.2 4.6 0 9.1-.7 13.7 0 6.8.8 14 1.4 20.8.7 8.3-.5 13.7-.1 22 0l7.2-.5L82.1 129c14.3-.7 28.6-.3 43-.4 14-.8 28.2 1 42.2-.6 13.3-1 26.7.2 40.1-.5 7.2-.7 14.4.2 21.6-.4 6.8-.5 11.8-.2 13.2-6q.3-7.3 1.2-14.5l0-.2q.5-10.5 1.4-21c.7-10.6-.4-21.2-.7-31.8q-1.1-20.2-1-40.6c1.7-7.4-4.3-12.8-11.5-11l-24.5 1.5c-6 .9-12-.1-18 .3-6.5-.4-13.1-1.6-19.6 0-10.7.5-21.3-1-32-.5-8.6.1-17.1 1-25.7 0h-5l-.2.1c-8.3-.1-16.6 0-24.9-1.3-11.5-.8-23 1.4-34.6 1.4q-12.2.3-24.4-.5c-6-.3-12-1.2-18-1.1-3.8 1.8-3 6.9-3 10.4q0 4.5.4 8.8"/></svg>') 10 10 10 10 stretch stretch;
}
`

const generateBoxVariant = (className, color, fill = color, size = 10) => {
  const isNone = fill === 'none';
  return `
.${className} {
  border-style: solid;
  background-color: ${isNone ? 'transparent' : '#' + fill};
  background-clip: padding-box;
  border-width: ${size}px;
  border-radius: ${size + 2}px;
  border-image: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="263.1" height="140.1" viewBox="0 0 246.7 131.3"><path fill="${isNone ? 'none' : '%23' + fill}" stroke="%23${color}" stroke-linecap="round" stroke-linejoin="round" stroke-width="${size / 3}" d="M2.1 21.6c-.2 12.5 2 25 .9 37.4q-.5 12.3.1 24.4c0 12.7-.7 24.4.1 37.1 3.3 5.8 10.1 7.6 16 8.2 4.6 0 9.1-.7 13.7 0 6.8.8 14 1.4 20.8.7 8.3-.5 13.7-.1 22 0l7.2-.5L82.1 129c14.3-.7 28.6-.3 43-.4 14-.8 28.2 1 42.2-.6 13.3-1 26.7.2 40.1-.5 7.2-.7 14.4.2 21.6-.4 6.8-.5 11.8-.2 13.2-6q.3-7.3 1.2-14.5l0-.2q.5-10.5 1.4-21c.7-10.6-.4-21.2-.7-31.8q-1.1-20.2-1-40.6c1.7-7.4-4.3-12.8-11.5-11l-24.5 1.5c-6 .9-12-.1-18 .3-6.5-.4-13.1-1.6-19.6 0-10.7.5-21.3-1-32-.5-8.6.1-17.1 1-25.7 0h-5l-.2.1c-8.3-.1-16.6 0-24.9-1.3-11.5-.8-23 1.4-34.6 1.4q-12.2.3-24.4-.5c-6-.3-12-1.2-18-1.1-3.8 1.8-3 6.9-3 10.4q0 4.5.4 8.8"/></svg>') ${size} stretch;
}
`;
};

const generateBoxVariantMulti = (selectors, color, fill = color, size = 10) => {
  const isNone = fill === 'none';
  const selectorStr = Array.isArray(selectors) ? selectors.join(', ') : selectors;
  return `
${selectorStr} {
  border-style: solid;
  background-color: ${isNone ? 'transparent' : '#' + fill};
  background-clip: padding-box;
  border-width: ${size}px;
  border-radius: ${size + 2}px;
  border-image: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="263.1" height="140.1" viewBox="0 0 246.7 131.3"><path fill="${isNone ? 'none' : '%23' + fill}" stroke="%23${color}" stroke-linecap="round" stroke-linejoin="round" stroke-width="${size / 3}" d="M2.1 21.6c-.2 12.5 2 25 .9 37.4q-.5 12.3.1 24.4c0 12.7-.7 24.4.1 37.1 3.3 5.8 10.1 7.6 16 8.2 4.6 0 9.1-.7 13.7 0 6.8.8 14 1.4 20.8.7 8.3-.5 13.7-.1 22 0l7.2-.5L82.1 129c14.3-.7 28.6-.3 43-.4 14-.8 28.2 1 42.2-.6 13.3-1 26.7.2 40.1-.5 7.2-.7 14.4.2 21.6-.4 6.8-.5 11.8-.2 13.2-6q.3-7.3 1.2-14.5l0-.2q.5-10.5 1.4-21c.7-10.6-.4-21.2-.7-31.8q-1.1-20.2-1-40.6c1.7-7.4-4.3-12.8-11.5-11l-24.5 1.5c-6 .9-12-.1-18 .3-6.5-.4-13.1-1.6-19.6 0-10.7.5-21.3-1-32-.5-8.6.1-17.1 1-25.7 0h-5l-.2.1c-8.3-.1-16.6 0-24.9-1.3-11.5-.8-23 1.4-34.6 1.4q-12.2.3-24.4-.5c-6-.3-12-1.2-18-1.1-3.8 1.8-3 6.9-3 10.4q0 4.5.4 8.8"/></svg>') ${size} stretch;
}
`;
};

// Programmatic color resolver for CSS variables (converting hex/rgb/rgba to url-compatible hex values)
const parseColorToHex = (colorVal) => {
  if (!colorVal) return 'none';
  colorVal = colorVal.trim();
  if (colorVal.startsWith('#')) {
    return colorVal.slice(1);
  }
  if (colorVal.startsWith('rgba') || colorVal.startsWith('rgb')) {
    const match = colorVal.match(/\d+(\.\d+)?/g);
    if (match) {
      const r = parseInt(match[0], 10);
      const g = parseInt(match[1], 10);
      const b = parseInt(match[2], 10);
      const a = match[3] ? parseFloat(match[3]) : 1;
      
      if (a === 0) return 'none';
      
      const toHex = (c) => c.toString(16).padStart(2, '0');
      if (a < 1) {
        const alphaHex = Math.round(a * 255).toString(16).padStart(2, '0');
        return `${toHex(r)}${toHex(g)}${toHex(b)}${alphaHex}`;
      }
      return `${toHex(r)}${toHex(g)}${toHex(b)}`;
    }
  }
  if (colorVal === 'transparent') return 'none';
  return colorVal;
};

const getCSSVar = (name) => {
  const val = getComputedStyle(document.documentElement).getPropertyValue(name);
  return val ? val.trim() : '';
};

// Generate styles dynamically using actual theme CSS variables
const bgColor = parseColorToHex(getCSSVar('--bg-color'));
const cardBg = parseColorToHex(getCSSVar('--card-bg'));
const accentColor = parseColorToHex(getCSSVar('--accent-color'));
const accentHover = parseColorToHex(getCSSVar('--accent-hover'));
const discordColor = parseColorToHex(getCSSVar('--discord-color'));
const discordHover = parseColorToHex(getCSSVar('--discord-hover'));
const dangerButtonBg = parseColorToHex(getCSSVar('--danger-button-bg'));
const dangerColor = parseColorToHex(getCSSVar('--danger-color'));
const dangerBg = parseColorToHex(getCSSVar('--danger-bg'));
const successColor = parseColorToHex(getCSSVar('--success-color'));
const successBg = parseColorToHex(getCSSVar('--success-bg'));
const surface = parseColorToHex(getCSSVar('--surface'));
const surface2 = parseColorToHex(getCSSVar('--surface2'));
const textSecondary = parseColorToHex(getCSSVar('--text-secondary'));
const textMuted = parseColorToHex(getCSSVar('--text-muted'));
const borderColor = parseColorToHex(getCSSVar('--border-color'));

const styleEl = document.createElement('style');
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
  ${generateBoxVariantMulti(
    ['input[type="text"]', 'input[type="password"]', 'select'],
    borderColor || 'ffffff14',
    '00000033',
    8
  )}
  ${generateBoxVariantMulti(
    ['input[type="text"]:focus', 'input[type="password"]:focus', 'select:focus'],
    accentColor,
    '00000033',
    8
  )}

  /* Status Banners */
  ${generateBoxVariant('status-success', successColor, successBg, 10)}
  ${generateBoxVariant('status-error', dangerColor, dangerBg, 10)}

  /* Wrapper layouts & Table wraps & logs */
  ${generateBoxVariant('char-table-wrapper', surface, surface, 10)}
  ${generateBoxVariant('table-wrap', surface, surface, 10)}
  ${generateBoxVariant('box', surface, surface, 10)}
  ${generateBoxVariant('log-box', borderColor || 'ffffff14', bgColor, 10)}

  /* White/Black box fallbacks */
  ${generateBoxVariant('white-box', 'ffffff', 'none', 8)}
  ${generateBoxVariant('black-box', '000000', 'none', 10)}


`;
document.head.appendChild(styleEl);