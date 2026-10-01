"""Crab Arena battle engine (local Ollama models).

Several gladiators, usually all running the same local model, answer the same
question. Each one gets its own random seed and temperature (and optionally a
distinct "fighting style"), so the answers differ. Then, round after round, every
survivor must make a real argument: attack a specific claim in a rival's answer
and defend its own answer against last round's attacks. The Emperor (a judge
model) reads the answers and the arguments and eliminates the gladiator whose
answer was most convincingly refuted. The last crab standing wins.

The engine runs on a worker thread and pushes events into a queue that the
frontend drains by polling.
"""

import json
import random
import subprocess
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

OLLAMA = "http://127.0.0.1:11434"

GLADIATORS = {
    "g0": {"name": "Maximus",     "style": "The Scholar",     "hint": "Be thorough and evidence-first: give the reasons and facts behind every claim."},
    "g1": {"name": "Crixus",      "style": "The Contrarian",  "hint": "Question the conventional wisdom: point out where the obvious answer is incomplete or wrong, but stay correct."},
    "g2": {"name": "Spartacus",   "style": "The Pragmatist",  "hint": "Be practical and actionable: focus on what someone should actually do."},
    "g3": {"name": "Flamma",      "style": "The Skeptic",     "hint": "Be careful about uncertainty, caveats and edge cases; never overclaim."},
    "g4": {"name": "Priscus",     "style": "The Minimalist",  "hint": "Give the shortest answer that is fully correct. No filler."},
    "g5": {"name": "Verus",       "style": "The Storyteller", "hint": "Explain with a concrete example or analogy that makes it click."},
    "g6": {"name": "Tetraites",   "style": "The Strategist",  "hint": "Structure the answer clearly, step by step, weighing the options."},
    "g7": {"name": "Carpophorus", "style": "The Wildcard",    "hint": "Find a creative, unexpected angle that is still genuinely right and useful."},
}

ANSWER_SYSTEM = (
    "You are {name}, a gladiator in the Crab Arena. Other gladiators are answering the "
    "exact same question, and afterwards you will debate until only one survives, judged "
    "purely on the substance of your answer and your arguments. Give the most accurate, "
    "genuinely helpful answer you can in under 200 words. Light markdown is fine. Do not "
    "mention the arena or the other gladiators in your answer.{hint}"
)

ARGUE_SYSTEM = (
    "You are {name}, a gladiator crab in a Roman arena debate. You win ONLY with real "
    "arguments: specific, reasoned, checkable criticism of a rival's claims and a solid "
    "defence of your own. The Emperor who judges ignores insults, bluster and style. You may "
    "sound like a proud gladiator, but every sentence must carry substance."
)

JUDGE_SYSTEM = (
    "You are the Emperor judging a debate in the Crab Arena. You are theatrical but strictly "
    "fair. You judge substance only: accuracy, helpfulness and clarity of each answer, and "
    "whether the criticisms raised against it are actually valid and went unanswered. You "
    "ignore insults, confidence, length, and how many gladiators attacked whom."
)


def _short(text, words):
    """Trim model text to a speech-bubble one-liner."""
    w = str(text).strip().split()
    return " ".join(w[:words]) + ("…" if len(w) > words else "")


def ollama_request(path, body=None, timeout=5.0):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        OLLAMA + path, data=data, headers={"Content-Type": "application/json"},
        method="POST" if body is not None else "GET",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def ollama_models():
    """Returns a list of chat-capable model names, or None if Ollama isn't reachable."""
    try:
        tags = ollama_request("/api/tags", timeout=2.5)
    except (urllib.error.URLError, OSError, ValueError):
        return None
    names = [m["name"] for m in tags.get("models", [])]
    return sorted(n for n in names if "embed" not in n.lower())


def start_ollama(wait=20.0):
    """Starts `ollama serve` in the background if it isn't running. Returns True once reachable."""
    if ollama_models() is not None:
        return True
    try:
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(subprocess, "DETACHED_PROCESS", 0)
        subprocess.Popen(["ollama", "serve"], creationflags=flags,
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL)
    except OSError:
        return False
    end = time.time() + wait
    while time.time() < end:
        if ollama_models() is not None:
            return True
        time.sleep(0.5)
    return False


class Battle:
    def __init__(self, model, judge_model, question, fighter_ids, use_styles=True):
        self.model = model
        self.judge_model = judge_model or model
        self.question = question
        self.fighters = [f for f in fighter_ids if f in GLADIATORS]
        self.use_styles = use_styles
        # every gladiator gets its own seed + temperature so identical models still diverge
        self.params = {f: {"seed": random.randint(1, 2**31 - 1), "temperature": round(random.uniform(0.7, 1.05), 2)}
                       for f in self.fighters}
        self.answers = {}
        self.alive = []
        self.history = []          # (round, attacker, target, attack, defence)
        self.quips = {}
        self.tokens = 0
        self.started = time.time()
        self._events = []
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    # ---- plumbing -------------------------------------------------------
    def start(self):
        self._thread.start()

    def stop(self):
        self._stop.set()

    def drain(self):
        with self._lock:
            out, self._events = self._events, []
        return out

    def _emit(self, **ev):
        with self._lock:
            self._events.append(ev)

    def _name(self, fid):
        return GLADIATORS[fid]["name"]

    def _chat(self, model, system, user, temperature, seed, fmt=None, num_predict=700):
        body = {
            "model": model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "stream": False,
            "keep_alive": "10m",
            "options": {"temperature": temperature, "seed": seed, "num_ctx": 8192, "num_predict": num_predict},
        }
        if fmt:
            body["format"] = fmt
        data = ollama_request("/api/chat", body, timeout=900)
        self.tokens += int(data.get("eval_count") or 0)
        self._emit(type="stats", tokens=self.tokens, secs=round(time.time() - self.started))
        return (data.get("message") or {}).get("content", "").strip()

    def _unload(self):
        for m in {self.model, self.judge_model}:
            try:
                ollama_request("/api/generate", {"model": m, "keep_alive": 0}, timeout=10)
            except (urllib.error.URLError, OSError, ValueError):
                pass

    # ---- phases ---------------------------------------------------------
    def _run(self):
        try:
            if ollama_models() is None:
                self._emit(type="fatal", message="Ollama isn't running. Start it and try again.")
                return
            self._emit(type="start", fighters=self.fighters, model=self.model)
            self._answer_phase()
            if self._stop.is_set():
                return
            if not self.alive:
                self._emit(type="fatal", message=f"No gladiator could answer. Is '{self.model}' installed? (ollama pull {self.model})")
                return
            rnd = 0
            while len(self.alive) > 1 and not self._stop.is_set():
                rnd += 1
                self._round(rnd)
            if self.alive and not self._stop.is_set():
                self._emit(type="winner", id=self.alive[0], answer=self.answers[self.alive[0]])
        except Exception as e:  # keep the UI alive whatever happens
            self._emit(type="fatal", message=f"{type(e).__name__}: {e}")
        finally:
            self._emit(type="done")
            self._unload()

    def _answer_one(self, fid):
        g, p = GLADIATORS[fid], self.params[fid]
        hint = f"\n\nYour fighting style: {g['hint']}" if self.use_styles else ""
        try:
            text = self._chat(self.model, ANSWER_SYSTEM.format(name=g["name"], hint=hint),
                              self.question, p["temperature"], p["seed"], num_predict=600)
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:160]
            return fid, None, f"HTTP {e.code}: {detail}"
        except (urllib.error.URLError, OSError) as e:
            return fid, None, f"could not reach Ollama ({e})"
        if not text:
            return fid, None, "returned an empty answer"
        return fid, text, None

    def _answer_phase(self):
        # Ollama serves a few requests at once; more workers than that just queue
        with ThreadPoolExecutor(max_workers=min(4, len(self.fighters))) as pool:
            futures = [pool.submit(self._answer_one, f) for f in self.fighters]
            for fut in as_completed(futures):
                fid, text, err = fut.result()
                if self._stop.is_set():
                    return
                if err:
                    self._emit(type="dq", id=fid, reason=err)
                else:
                    self.answers[fid] = text
                    self._emit(type="answer", id=fid, text=text)
        self.alive = [f for f in self.fighters if f in self.answers]
        self._emit(type="answers_done", alive=list(self.alive))

    def _answers_block(self, ids):
        return "\n\n".join(f"=== {self._name(f)} ===\n{self.answers[f]}" for f in ids)

    def _argue_one(self, fid, rnd):
        rivals = [f for f in self.alive if f != fid]
        rival_names = [self._name(r) for r in rivals]
        me = self._name(fid)
        prev = [h for h in self.history if h[0] == rnd - 1]
        against_me = [h for h in prev if h[2] == me]
        past = "\n".join(f"- {a} attacked {t}: {atk}  |  {a}'s defence: {dfn}" for _, a, t, atk, dfn in prev) or "(this is the first round)"
        attacks = "\n".join(f"- {a}: {atk}" for _, a, _, atk, _ in against_me) or "(nobody attacked you last round)"
        user = (
            f"THE QUESTION:\n{self.question}\n\n"
            f"ANSWERS STILL IN THE ARENA:\n{self._answers_block(self.alive)}\n\n"
            f"LAST ROUND'S ARGUMENTS:\n{past}\n\n"
            f"ATTACKS MADE AGAINST YOU ({me}):\n{attacks}\n\n"
            f"Round {rnd}. You are {me}. One gladiator will be eliminated this round.\n"
            f"1. ATTACK: choose the rival (one of: {', '.join(rival_names)}) whose answer is weakest. "
            "Name the exact claim or gap in THEIR answer and explain concretely why it is wrong, "
            "misleading or missing something important (max 60 words).\n"
            "2. DEFENCE: answer the attacks made against you, or if there were none, give the single "
            "strongest reason your answer is better than the rest. If an attack is valid, concede it "
            "and explain why your answer still holds (max 45 words).\n"
            "3. QUIP: one punchy line for the crowd that names your target and the flaw you attacked "
            "(max 12 words), e.g. \"Priscus forgot the one exception that matters!\"\n"
            "Never attack yourself. No empty insults."
        )
        schema = {
            "type": "object",
            "properties": {
                "target": {"type": "string", "enum": rival_names},
                "attack": {"type": "string"},
                "defense": {"type": "string"},
                "quip": {"type": "string"},
            },
            "required": ["target", "attack", "defense", "quip"],
        }
        p = self.params[fid]
        data = {}
        try:
            raw = self._chat(self.model, ARGUE_SYSTEM.format(name=me), user,
                             min(p["temperature"], 0.8), p["seed"] + rnd, fmt=schema, num_predict=400)
            data = json.loads(raw)
        except (urllib.error.URLError, OSError, ValueError):
            pass
        name_to_id = {self._name(r): r for r in rivals}
        target = name_to_id.get(str(data.get("target", ""))) or random.choice(rivals)
        attack = str(data.get("attack") or "").strip() or "*clacks its claws but cannot find the words*"
        defense = str(data.get("defense") or "").strip()
        self.quips[fid] = _short(data.get("quip") or attack, 14)
        return fid, target, attack, defense

    def _round(self, rnd):
        self._emit(type="round", n=rnd, alive=list(self.alive))
        with ThreadPoolExecutor(max_workers=min(4, len(self.alive))) as pool:
            results = list(pool.map(lambda f: self._argue_one(f, rnd), self.alive))
        if self._stop.is_set():
            return
        attackers = {}
        for fid, target, attack, defense in results:
            self._emit(type="taunt", id=fid, target=target, text=attack, defense=defense, quip=self.quips.get(fid, ""))
            self.history.append((rnd, self._name(fid), self._name(target), attack, defense))
            attackers.setdefault(target, []).append(fid)

        doomed, verdict, short = self._judge(results, rnd)
        if self._stop.is_set():
            return
        self._emit(type="verdict", doomed=doomed, text=verdict, short=short, tied=list(self.alive))
        self.alive.remove(doomed)
        self._emit(
            type="eliminate", id=doomed, voters=attackers.get(doomed, []),
            tally={f: len(v) for f, v in attackers.items()}, by_emperor=True,
            final=len(self.alive) == 1,
        )

    def _judge(self, results, rnd):
        order = list(self.alive)
        random.shuffle(order)  # avoid position bias
        names = [self._name(f) for f in order]
        args = "\n".join(
            f"- {self._name(a)} attacks {self._name(t)}: {atk}\n  {self._name(a)} defends: {dfn}"
            for a, t, atk, dfn in results
        )
        final = len(self.alive) == 2
        user = (
            f"THE QUESTION:\n{self.question}\n\n"
            f"THE ANSWERS:\n{self._answers_block(order)}\n\n"
            f"ROUND {rnd} ARGUMENTS:\n{args}\n\n"
            + ("This is the FINAL duel: the survivor is crowned champion. " if final else "")
            + f"Eliminate exactly one of: {', '.join(names)}. Choose the gladiator whose ANSWER is "
            "weakest once you account for which criticisms are actually valid and how well each "
            "defended itself. Give the concrete reason in one dramatic imperial sentence (max 35 words)."
        )
        schema = {
            "type": "object",
            "properties": {"eliminated": {"type": "string", "enum": names}, "reason": {"type": "string"}},
            "required": ["eliminated", "reason"],
        }
        data = {}
        try:
            raw = self._chat(self.judge_model, JUDGE_SYSTEM, user, 0.2, 1000 + rnd, fmt=schema, num_predict=250)
            data = json.loads(raw)
        except (urllib.error.URLError, OSError, ValueError):
            pass
        by_name = {self._name(f): f for f in self.alive}
        doomed = by_name.get(str(data.get("eliminated", "")))
        if not doomed:
            # judge failed: fall back to the most-attacked gladiator
            counts = {f: 0 for f in self.alive}
            for _, t, _, _ in results:
                counts[t] += 1
            doomed = max(self.alive, key=lambda f: (counts[f], random.random()))
        reason = str(data.get("reason") or "").strip() or "The Emperor yawns and turns his thumb down."
        return doomed, reason, _short(reason, 12)
