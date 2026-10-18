# SF Pro for your files folder

```sh
python3 -m venv ~/.venvs/hk-sf && ~/.venvs/hk-sf/bin/pip install fonttools brotli
~/.venvs/hk-sf/bin/python make_woff2.py /Library/Fonts/SF-Pro.ttf /config/hk_local/fonts/SF-Pro.woff2
```

Or skip it: Apple's `SF-Pro.ttf` itself works in `fonts/` (the stylesheet
falls back to it); the woff2 is the same font at roughly a third of the size.
It must be the VARIABLE `SF-Pro.ttf`, not one of the static `SF-Pro-Display-*`
cuts — the tool refuses those, because every weight would render as one.
