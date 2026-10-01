"""Crab Arena desktop app: a pywebview window around the pixel-art arena."""

import json
import os
import sys
from pathlib import Path

import webview

from engine import GLADIATORS, Battle, ollama_models, start_ollama

CONFIG_DIR = Path(os.environ.get("APPDATA", Path.home())) / "CrabArena"
CONFIG_FILE = CONFIG_DIR / "config.json"


def resource(rel):
    base = getattr(sys, "_MEIPASS", Path(__file__).parent)
    return str(Path(base) / rel)


def load_config():
    try:
        return json.loads(CONFIG_FILE.read_text("utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def save_config(cfg):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2), "utf-8")


class Api:
    def __init__(self):
        self._battle = None

    def get_setup(self):
        cfg = load_config()
        return {
            "gladiators": [{"id": k, "name": v["name"], "style": v["style"]} for k, v in GLADIATORS.items()],
            "models": ollama_models(),
            "last_fighters": cfg.get("fighters", []),
            "model": cfg.get("model", ""),
            "judge": cfg.get("judge", ""),
            "styles": cfg.get("styles", True),
        }

    def ollama_status(self):
        return {"models": ollama_models()}

    def start_ollama(self):
        ok = start_ollama()
        return {"ok": ok, "models": ollama_models()}

    def start_battle(self, question, fighter_ids, model, judge, styles):
        if self._battle:
            self._battle.stop()
        cfg = load_config()
        cfg.update(fighters=fighter_ids, model=model, judge=judge, styles=bool(styles))
        save_config(cfg)
        self._battle = Battle(model, judge or model, question, fighter_ids, bool(styles))
        self._battle.start()
        return {"ok": True}

    def poll(self):
        return self._battle.drain() if self._battle else []

    def stop_battle(self):
        if self._battle:
            self._battle.stop()
            self._battle = None
        return {"ok": True}


def main():
    api = Api()
    webview.create_window(
        "Crab Arena", url=resource("web/index.html"), js_api=api,
        width=1320, height=800, min_size=(960, 600), background_color="#1a120b",
    )
    webview.start(debug="--debug" in sys.argv)


if __name__ == "__main__":
    main()
