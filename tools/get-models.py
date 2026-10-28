#!/usr/bin/env python3
"""Download on-device speech models into models/ (run once on your computer, then deploy as usual).

    python3 tools/get-models.py de fr es        # only these languages
    python3 tools/get-models.py all             # everything below (~230 MB)

Each model is a small Vosk model (32-46 MB, Apache 2.0) hosted by the vosk-browser project.
English ships with the app already. Languages without a file simply use the browser (Google) engine.
Not covered here (no small model available there): Russian, Ukrainian, Polish, Romanian.
More models: https://alphacephei.com/vosk/models  (re-pack a model folder as .tar.gz, name it models/<code>.tar.gz
and add the code to LOCAL_MODELS in js/engine-local.js)."""
import os, sys, urllib.request

BASE = "https://raw.githubusercontent.com/ccoreilly/vosk-browser/gh-pages/models/"
MODELS = {
    "en": "vosk-model-small-en-us-0.15.tar.gz",
    "de": "vosk-model-small-de-0.15.tar.gz",
    "fr": "vosk-model-small-fr-pguyot-0.3.tar.gz",
    "es": "vosk-model-small-es-0.3.tar.gz",
    "it": "vosk-model-small-it-0.4.tar.gz",
    "pt": "vosk-model-small-pt-0.3.tar.gz",
    "tr": "vosk-model-small-tr-0.3.tar.gz",
}
OUT = {"en": "en-us"}   # file names used by js/engine-local.js

def main():
    want = sys.argv[1:] or ["all"]
    langs = list(MODELS) if "all" in want else want
    here = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "models")
    os.makedirs(here, exist_ok=True)
    for code in langs:
        if code not in MODELS:
            print("unknown language:", code, "(available:", ", ".join(MODELS) + ")"); continue
        dst = os.path.join(here, OUT.get(code, code) + ".tar.gz")
        if os.path.exists(dst):
            print(code, "already there"); continue
        print("downloading", code, "...", flush=True)
        urllib.request.urlretrieve(BASE + MODELS[code], dst)
        print("  saved", os.path.relpath(dst), round(os.path.getsize(dst) / 1e6, 1), "MB")

if __name__ == "__main__":
    main()
