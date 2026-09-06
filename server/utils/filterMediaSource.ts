import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import http, { type IncomingMessage } from 'node:http'
import https from 'node:https'

const blocked = new BlockList()
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const)
  blocked.addSubnet(address, prefix, 'ipv4')
const publicV6 = new BlockList()
publicV6.addSubnet('2000::', 3, 'ipv6')
for (const [address, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3ffe::', 16],
] as const)
  blocked.addSubnet(address, prefix, 'ipv6')

export function isPublicMediaAddress(address: string) {
  const family = isIP(address)
  if (family === 4) return !blocked.check(address, 'ipv4')
  return (
    family === 6 && publicV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6')
  )
}

export function filterMediaUrl(raw: string) {
  const url = new URL(raw)
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && !['80', '443'].includes(url.port)) ||
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    (isIP(hostname) && !isPublicMediaAddress(hostname))
  )
    throw new Error('Unsupported media URL')
  return url
}

export async function openFilterMedia(
  raw: string,
  range: string | undefined,
  signal: AbortSignal
): Promise<IncomingMessage> {
  let url = filterMediaUrl(raw)
  if (range && !/^bytes=\d*-\d*$/.test(range)) throw new Error('Unsupported byte range')
  for (let redirects = 0; redirects <= 4; redirects++) {
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    const addresses = await lookup(hostname, { all: true })
    if (
      !addresses.length ||
      addresses.some((entry) => !isPublicMediaAddress(entry.address))
    )
      throw new Error('Media host is not public')
    const address = addresses.find((entry) => entry.family === 4) ?? addresses[0]!
    // Pin the checked result to the connection; never let a second DNS lookup
    // rebind a public hostname to a private address. Recheck every redirect.
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const req = (url.protocol === 'https:' ? https : http).get(
        url,
        {
          agent: false,
          signal,
          headers: {
            'User-Agent': 'zvid-editor/1.0',
            ...(range ? { Range: range } : {}),
          },
          lookup: (_host: string, options: any, callback: any) =>
            options?.all
              ? callback(null, [address])
              : callback(null, address.address, address.family),
        },
        resolve
      )
      req.once('error', reject)
      req.setTimeout(20_000, () => req.destroy(new Error('Media request timed out')))
    })
    if (
      response.statusCode &&
      response.statusCode >= 300 &&
      response.statusCode < 400 &&
      response.headers.location
    ) {
      response.destroy()
      url = filterMediaUrl(new URL(response.headers.location, url).href)
      continue
    }
    return response
  }
  throw new Error('Too many media redirects')
}
