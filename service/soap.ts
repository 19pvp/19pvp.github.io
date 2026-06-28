const password = (Deno.env.get('PASSWORD') || '').slice(0, 16)
const soapPort = Deno.env.get('SOAP_PORT') || '7878'

const authorization = `Basic ${btoa(`system:${password}`)}`

const makeSoapBody = (command: string) => `
<?xml version="1.0" encoding="utf-8"?>
<SOAP-ENV:Envelope
xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"
xmlns:xsi="http://www.w3.org/1999/XMLSchema-instance"
xmlns:xsd="http://www.w3.org/1999/XMLSchema"
xmlns:ns1="urn:AC">
  <SOAP-ENV:Body>
    <ns1:executeCommand><command>${command}</command></ns1:executeCommand>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>
`

const xmlEntities: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  mdash: '—',
  ndash: '–',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
}

const decodeEntity = (_: string, entity: string) => {
  if (entity[0] !== '#') return xmlEntities[entity] || ''
  return String.fromCodePoint(
    entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)),
  )
}

const ignoreError = () => ''

const parseSoapTag = (text: string, tag: string) => {
  const start = text.indexOf(`<${tag}>`)
  const end = text.lastIndexOf(`</${tag}>`)
  if (start === -1 || end === -1) return ''
  return text
    .slice(start + tag.length + 2, end)
    .replace(/&([^;]+);/g, decodeEntity)
}

const parseSoap = (text: string) => {
  const result = parseSoapTag(text, 'result')
  if (result) return result.split('\r\n').filter(Boolean)
  const faultcode = parseSoapTag(text, 'faultcode') || 'No Code'
  const faultstring = parseSoapTag(text, 'faultstring') || 'No message'
  return { code: faultcode, message: faultstring }
}

export const ac = async (strings: TemplateStringsArray, ...values: unknown[]) => {
  try {
    const res = await fetch(`http://127.0.0.1:${soapPort}`, {
      method: 'POST',
      headers: { authorization },
      signal: AbortSignal.timeout(2000),
      body: makeSoapBody(String.raw(strings, ...values)),
    })
    const output = await res.text().then(parseSoap, ignoreError)
    return res.ok ? { success: true, output } : { error: res.status, output }
  } catch (err) {
    return { error: 600, output: err }
  }
}
