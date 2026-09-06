import { describe, it, expect } from 'vitest'
import {
  filterMediaUrl,
  isPublicMediaAddress,
  openFilterMedia,
} from '../../server/utils/filterMediaSource'

describe('filter media relay boundaries', () => {
  it('rejects private, special, mapped and invalid addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '10.0.0.2',
      '172.31.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
      '192.0.2.1',
      '::',
      '::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      'fc00::1',
      'fe80::1',
      '2001:db8::1',
      '2002:7f00:1::',
      'not-an-ip',
    ])
      expect(isPublicMediaAddress(ip), ip).toBe(false)
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])
      expect(isPublicMediaAddress(ip)).toBe(true)
  })
  it('validates schemes, credentials, port and IP URL normalization', () => {
    for (const url of [
      'file:///etc/passwd',
      'ftp://example.com/a',
      'http://user:pass@example.com/a',
      'http://example.com:3000/a',
      'http://localhost/a',
      'http://x.local/a',
      'http://127.1/a',
      'http://2130706433/a',
      'http://0x7f000001/a',
      'http://[::ffff:7f00:1]/a',
    ])
      expect(() => filterMediaUrl(url), url).toThrow()
    expect(filterMediaUrl('https://example.com/a.png?q=1').href).toBe(
      'https://example.com/a.png?q=1'
    )
  })
  it('rejects private DNS answers and multiple or malformed ranges', async () => {
    await expect(
      openFilterMedia(
        'https://example.com/a',
        'bytes=0-1,5-6',
        new AbortController().signal
      )
    ).rejects.toThrow('byte range')
    await expect(
      openFilterMedia('http://localhost./a', undefined, new AbortController().signal)
    ).rejects.toThrow('not public')
  })
})
