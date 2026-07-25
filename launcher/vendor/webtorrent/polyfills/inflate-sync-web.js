import { inflate } from 'npm:pako'

export const inflateSync = (buffer) => inflate(buffer, { to: 'string' })
