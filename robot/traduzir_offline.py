#!/usr/bin/env python3
"""JSON stdin: {texts:[...]}; stdout: {translations:[...]}.
Uses a locally installed Argos Translate en->pt model; no paid translation API.
"""
import json, sys

def main():
    data = json.load(sys.stdin)
    texts = data.get('texts', [])
    if not isinstance(texts, list) or len(texts) > 100 or any(not isinstance(t, str) or len(t) > 12000 for t in texts):
        raise ValueError('Invalid translation batch')
    import argostranslate.translate
    languages = argostranslate.translate.get_installed_languages()
    en = next((l for l in languages if l.code == 'en'), None)
    pt = next((l for l in languages if l.code == 'pt'), None)
    if en is None or pt is None:
        raise RuntimeError('Argos en->pt model not installed')
    translator = en.get_translation(pt)
    if translator is None:
        raise RuntimeError('Argos en->pt model not installed')
    print(json.dumps({'translations': [translator.translate(t) if t.strip() else '' for t in texts]}, ensure_ascii=False))

if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
