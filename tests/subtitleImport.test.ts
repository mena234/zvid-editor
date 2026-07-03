import { describe, it, expect } from 'vitest'
import { parseSubtitleFile, parseAss } from '../utils/subtitleRuntime'

const SRT = `1
00:00:01,000 --> 00:00:02,500
<b>Hello there</b>

2
00:00:03,000 --> 00:00:04,000
<b><font color="#ffee00">Bright bold line</font></b>
`

const VTT = `WEBVTT

00:01.000 --> 00:02.000 line:10% align:center
Top line one

00:03.000 --> 00:04.000 line:12%
Top line two
`

const ASS = `[Script Info]
Title: sample
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Montserrat,86,&H00A2EFF3,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,4,0,8,20,20,64,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.16,0:00:00.92,Default,,0,0,0,,{\\k12}You {\\k20}don't {\\k12}need
Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Plain line, with comma
Dialogue: 0,0:00:02.50,0:00:03.00,Default,,0,0,0,,{\\p1}m 0 0 l 100 0 100 100{\\p0}
Comment: 0,0:00:05.00,0:00:06.00,Default,,0,0,0,,ignored
`

describe('subtitle import', () => {
  it('parses SRT and lifts consistent bold/color into styles', () => {
    const { captions, styles, format } = parseSubtitleFile('subs.srt', SRT)
    expect(format).toBe('srt')
    expect(captions).toHaveLength(2)
    expect(captions[0].text).toBe('Hello there')
    expect(captions[0].start).toBeCloseTo(1)
    expect(captions[0].end).toBeCloseTo(2.5)
    expect(captions[0].words.length).toBe(2)
    expect(styles?.isBold).toBe(true)
    expect(styles?.color).toBe('#ffee00')
  })

  it('parses VTT cue settings into a position hint', () => {
    const { captions, styles, format } = parseSubtitleFile('subs.vtt', VTT)
    expect(format).toBe('vtt')
    expect(captions).toHaveLength(2)
    expect(captions[1].text).toBe('Top line two')
    expect(styles?.position).toBe('top-center')
  })

  it('parses ASS styles, karaoke words and skips drawings/comments', () => {
    const { captions, styles, format } = parseSubtitleFile('subs.ass', ASS)
    expect(format).toBe('ass')
    // drawing + comment lines dropped
    expect(captions).toHaveLength(2)

    // karaoke words: 12cs + 20cs + 12cs from 0.16
    const words = captions[0].words
    expect(words.map((w) => w.text)).toEqual(['You', "don't", 'need'])
    expect(words[0].start).toBeCloseTo(0.16, 2)
    expect(words[0].end).toBeCloseTo(0.28, 2)
    expect(words[1].start).toBeCloseTo(0.28, 2)
    expect(words[1].end).toBeCloseTo(0.48, 2)
    expect(words[2].end).toBeCloseTo(0.6, 2)

    // commas inside dialogue text survive
    expect(captions[1].text).toBe('Plain line, with comma')

    // style mapping
    expect(styles?.fontFamily).toBe('Montserrat')
    expect(styles?.fontSize).toBe(86)
    expect(styles?.isBold).toBe(true)
    expect(styles?.mode).toBe('karaoke')
    // karaoke: base color from SecondaryColour, active word from PrimaryColour
    expect(styles?.color).toBe('#ffffff')
    expect(styles?.activeWord?.color).toBe('#f3efa2')
    expect(styles?.outline).toEqual({ width: 4, color: '#000000' })
    expect(styles?.position).toBe('top-center')
    expect(styles?.marginV).toBe(64)
    expect(styles?.marginH).toBe(20)
  })

  it('maps BorderStyle 3 to a background box', () => {
    const boxAss = ASS.replace(
      ',100,100,0,0,1,4,0,8,20,20,64,1',
      ',100,100,0,0,3,0,0,2,0,0,0,1'
    ).replace('&H00000000,&H00000000,-1', '&H00000000,&H80202020,-1')
    const { styles } = parseAss(boxAss)
    expect(styles?.background).toBe('#202020')
    expect(styles?.outline).toBeUndefined()
    expect(styles?.position).toBeUndefined() // alignment 2 = default bottom-center
  })

  it('still accepts whisper json', () => {
    const json = JSON.stringify({
      segments: [
        {
          start: 0,
          end: 1,
          text: 'hi there',
          words: [
            { start: 0, end: 0.5, word: 'hi' },
            { start: 0.5, end: 1, word: 'there' },
          ],
        },
      ],
    })
    const { captions, format } = parseSubtitleFile('w.json', json)
    expect(format).toBe('whisper-json')
    expect(captions[0].words).toHaveLength(2)
  })
})
