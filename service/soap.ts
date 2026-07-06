import worldserverConfig from '../config/worldserver.json' with { type: 'json' }
import { unquote } from './utils.ts'

type SoapFault = {
  code: string
  message: string
}

type SoapResult = string[] | SoapFault

export type SoapResponse =
  | { success: true; output: SoapResult }
  | { error: number; output: unknown }

import { env } from './env.ts'

const password = () => env.PASSWORD.slice(0, 16)
const soapHost = () => env.SOAP_HOST || unquote(worldserverConfig['SOAP.IP']) || '127.0.0.1'
const soapPort = () => env.SOAP_PORT || worldserverConfig['SOAP.Port'] || '7878'

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

const parseSoapTag = (text: string, tag: string) => {
  const start = text.indexOf(`<${tag}>`)
  const end = text.lastIndexOf(`</${tag}>`)
  if (start === -1 || end === -1) return ''
  return text
    .slice(start + tag.length + 2, end)
    .replace(/&([^;]+);/g, decodeEntity)
}

const parseSoap = (text: string): SoapResult => {
  const result = parseSoapTag(text, 'result')
  if (result) return result.split('\r\n').filter(Boolean)
  return {
    code: parseSoapTag(text, 'faultcode') || 'No Code',
    message: parseSoapTag(text, 'faultstring') || 'No message',
  }
}

export const ac = async (strings: TemplateStringsArray, ...values: unknown[]): Promise<SoapResponse> => {
  const pass = password()
  if (!pass) return { error: 401, output: 'PASSWORD is required for SOAP requests' }

  try {
    const res = await fetch(`http://${soapHost()}:${soapPort()}`, {
      method: 'POST',
      headers: { authorization: `Basic ${btoa(`system:${pass}`)}` },
      signal: AbortSignal.timeout(2000),
      body: makeSoapBody(String.raw(strings, ...values)),
    })
    const text = await res.text().catch(() => '')
    const output = text ? parseSoap(text) : { code: 'No Body', message: 'SOAP response body could not be read' }
    return res.ok ? { success: true, output } : { error: res.status, output }
  } catch (err) {
    return { error: 600, output: err }
  }
}
