"""Regenerate qa-preview.ttf with fontTools (pip install fonttools).

An original, minimal ASCII-only test font. Rectangle glyphs intentionally avoid
any dependency on system/commercial fonts or external downloads in worker tests.
Not a product font, and not used for visual typography assertions.
"""
from pathlib import Path
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

names = [".notdef"] + [f"char{i}" for i in range(32, 127)]
builder = FontBuilder(1000, isTTF=True)
builder.setupGlyphOrder(names)
builder.setupCharacterMap({i: f"char{i}" for i in range(32, 127)})
glyphs = {}
for name in names:
    pen = TTGlyphPen(None)
    if name != "char32":
        pen.moveTo((80, 0))
        pen.lineTo((80, 700))
        pen.lineTo((460, 700))
        pen.lineTo((460, 0))
        pen.closePath()
    glyphs[name] = pen.glyph()
builder.setupGlyf(glyphs)
builder.setupHorizontalMetrics({name: (540, 80) for name in names})
builder.setupHorizontalHeader(ascent=800, descent=-200)
builder.setupNameTable({"familyName": "QA Preview", "styleName": "Regular", "uniqueFontIdentifier": "Zvid QA Preview Regular", "fullName": "QA Preview Regular", "psName": "QAPreview-Regular", "version": "Version 1.0"})
builder.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
builder.setupPost()
builder.setupMaxp()
builder.save(Path(__file__).with_name("qa-preview.ttf"))
