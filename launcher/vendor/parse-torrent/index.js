/*! parse-torrent. MIT License. WebTorrent LLC <https://webtorrent.io/opensource> */

import bencode from 'npm:bencode'
import fs from 'fs'
import magnet, { encode } from 'npm:magnet-uri'
import path from 'path'
import { arr2hex, arr2text, hash, text2arr } from 'npm:uint8-util'
import queueMicrotask from 'npm:queue-microtask'

export default async function parseTorrent(torrentId) {
  if (typeof torrentId === 'string' && /^(stream-)?magnet:/.test(torrentId)) {
    const torrent = magnet(torrentId)
    if (!torrent.infoHash) throw new Error('Invalid torrent identifier')
    return torrent
  }

  if (
    typeof torrentId === 'string' &&
    (/^[a-f0-9]{40}$/i.test(torrentId) || /^[a-z2-7]{32}$/i.test(torrentId))
  ) {
    return magnet(`magnet:?xt=urn:btih:${torrentId}`)
  }

  if (ArrayBuffer.isView(torrentId) && torrentId.length === 20) {
    return magnet(`magnet:?xt=urn:btih:${arr2hex(torrentId)}`)
  }

  if (ArrayBuffer.isView(torrentId)) return decodeTorrentFile(torrentId)

  if (torrentId?.infoHash) {
    torrentId.infoHash = torrentId.infoHash.toLowerCase()
    if (!torrentId.announce) torrentId.announce = []
    if (typeof torrentId.announce === 'string') {
      torrentId.announce = [torrentId.announce]
    }
    if (!torrentId.urlList) torrentId.urlList = []
    return torrentId
  }

  throw new Error('Invalid torrent identifier')
}

export function remote(torrentId, opts, cb) {
  if (typeof opts === 'function') return remote(torrentId, {}, opts)
  if (typeof cb !== 'function') {
    throw new Error('second argument must be a Function')
  }

  parseTorrent(torrentId).then((torrent) => {
    queueMicrotask(() => cb(null, torrent))
  }).catch(async () => {
    if (typeof torrentId === 'string' && /^https?:/.test(torrentId)) {
      try {
        const response = await fetch(torrentId, {
          headers: { 'user-agent': 'WebTorrent (https://webtorrent.io)' },
          signal: AbortSignal.timeout(30_000),
          ...opts,
        })
        return parseOrThrow(new Uint8Array(await response.arrayBuffer()))
      } catch (err) {
        return cb(new Error(`Error downloading torrent: ${err.message}`))
      }
    }

    if (typeof fs.readFile === 'function' && typeof torrentId === 'string') {
      return fs.readFile(torrentId, (err, data) => {
        if (err) return cb(new Error('Invalid torrent identifier'))
        parseOrThrow(data)
      })
    }

    queueMicrotask(() => cb(new Error('Invalid torrent identifier')))
  })

  async function parseOrThrow(data) {
    try {
      const torrent = await parseTorrent(data)
      cb(
        torrent.infoHash ? null : new Error('Invalid torrent identifier'),
        torrent,
      )
    } catch (err) {
      cb(err)
    }
  }
}

async function decodeTorrentFile(torrent) {
  torrent = bencode.decode(torrent)

  ensure(torrent.info, 'info')
  ensure(torrent.info['name.utf-8'] || torrent.info.name, 'info.name')
  ensure(torrent.info['piece length'], "info['piece length']")
  ensure(torrent.info.pieces, 'info.pieces')

  if (torrent.info.files) {
    torrent.info.files.forEach((file) => {
      ensure(typeof file.length === 'number', 'info.files[0].length')
      ensure(file['path.utf-8'] || file.path, 'info.files[0].path')
    })
  } else {
    ensure(typeof torrent.info.length === 'number', 'info.length')
  }

  const result = {
    info: torrent.info,
    infoBuffer: bencode.encode(torrent.info),
    name: arr2text(torrent.info['name.utf-8'] || torrent.info.name),
    announce: [],
  }

  result.infoHashBuffer = await hash(result.infoBuffer)
  result.infoHash = arr2hex(result.infoHashBuffer)

  if (torrent.info.private !== undefined) {
    result.private = !!torrent.info.private
  }
  if (torrent['creation date']) {
    result.created = new Date(torrent['creation date'] * 1000)
  }
  if (torrent['created by']) result.createdBy = arr2text(torrent['created by'])
  if (ArrayBuffer.isView(torrent.comment)) {
    result.comment = arr2text(torrent.comment)
  }

  if (
    Array.isArray(torrent['announce-list']) &&
    torrent['announce-list'].length > 0
  ) {
    torrent['announce-list'].forEach((urls) => {
      urls.forEach((url) => result.announce.push(arr2text(url)))
    })
  } else if (torrent.announce) {
    result.announce.push(arr2text(torrent.announce))
  }

  if (ArrayBuffer.isView(torrent['url-list'])) {
    torrent['url-list'] = torrent['url-list'].length > 0
      ? [torrent['url-list']]
      : []
  }
  result.urlList = (torrent['url-list'] || []).map((url) => arr2text(url))
  result.announce = Array.from(new Set(result.announce))
  result.urlList = Array.from(new Set(result.urlList))

  let sum = 0
  const files = torrent.info.files || [torrent.info]
  result.files = files.map((file) => {
    const parts = [].concat(result.name, file['path.utf-8'] || file.path || [])
      .map((p) => ArrayBuffer.isView(p) ? arr2text(p) : p)
    sum += file.length
    return {
      path: path.join.apply(null, [path.sep].concat(parts)).slice(1),
      name: parts[parts.length - 1],
      length: file.length,
      offset: sum - file.length,
    }
  })

  result.length = sum
  const lastFile = result.files[result.files.length - 1]
  result.pieceLength = torrent.info['piece length']
  result.lastPieceLength =
    ((lastFile.offset + lastFile.length) % result.pieceLength) ||
    result.pieceLength
  result.pieces = []
  for (let i = 0; i < torrent.info.pieces.length; i += 20) {
    result.pieces.push(arr2hex(torrent.info.pieces.slice(i, i + 20)))
  }

  return result
}

export function toTorrentFile(parsed) {
  const torrent = { info: parsed.info }
  torrent['announce-list'] = (parsed.announce || []).map((url) => {
    if (!torrent.announce) torrent.announce = url
    return [text2arr(url)]
  })
  torrent['url-list'] = parsed.urlList || []
  if (parsed.private !== undefined) torrent.private = Number(parsed.private)
  if (parsed.created) {
    torrent['creation date'] = (parsed.created.getTime() / 1000) | 0
  }
  if (parsed.createdBy) torrent['created by'] = parsed.createdBy
  if (parsed.comment) torrent.comment = parsed.comment
  return bencode.encode(torrent)
}

export const toMagnetURI = encode

function ensure(value, field) {
  if (!value) throw new Error(`Torrent is missing required field: ${field}`)
}
