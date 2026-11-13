"""Talk to any AI the team adds on the Providers page: text with ask(), pictures with image().

A provider's "kind" can be typed freely. Only the wire format matters:
  gemini              - Google Gemini (reads PDF pages; makes images with an image model)
  anthropic / claude  - Claude (reads PDF pages)
  anything else       - OpenAI-compatible URL: OpenAI, OpenRouter, Groq, DeepSeek, Mistral, Together,
                        Ollama, LM Studio, vLLM or any server on a rented GPU (RunPod, Vast.ai, ...)
"""
import base64
import json
import re
import time
import urllib.error
import urllib.request

DEFAULT_URL = {
    "openai": "https://api.openai.com/v1",
    "gemini": "https://generativelanguage.googleapis.com",
    "anthropic": "https://api.anthropic.com",
}


class AIError(Exception):
    pass


def wire(kind):
    k = (kind or "").strip().lower()
    return "gemini" if k.startswith("gemini") or k == "google" else "anthropic" if k in ("anthropic", "claude") else "openai"


def _base(p):
    w = wire(p["kind"])
    base = (p.get("base_url") or "").rstrip("/")
    if not base and w == "openai" and p["kind"].strip().lower() not in ("openai", ""):
        raise AIError(f"provider {p['name']!r}: kind {p['kind']!r} needs a base URL (an OpenAI-compatible endpoint)")
    return w, base or DEFAULT_URL[w]


def _post(url, body, headers, timeout=900):
    req = urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json", **headers})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise AIError(f"{e.code} from {url.split('?')[0]}: {e.read().decode(errors='replace')[:400]}") from e
    except (urllib.error.URLError, TimeoutError) as e:
        raise AIError(f"could not reach {url.split('?')[0]}: {e}") from e


def ask(p, system, user, pdf=None, temperature=0.3):
    """Returns (text, usage). p is a provider: {name, kind, base_url, model, api_key}."""
    w, base = _base(p)
    model, key = p["model"], p.get("api_key", "")
    if pdf and w == "openai":
        raise AIError("these pages have no text layer (scanned?). Use a Gemini or Claude provider: they can read PDF pages.")
    t0 = time.time()
    if w == "openai":
        headers = {"Authorization": f"Bearer {key}"} if key else {}
        r = _post(f"{base}/chat/completions", {
            "model": model, "temperature": temperature,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}, headers)
        try:
            text = r["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError) as e:
            raise AIError(f"unexpected reply: {str(r)[:300]}") from e
        u = r.get("usage") or {}
        usage = {"in": u.get("prompt_tokens", 0), "out": u.get("completion_tokens", 0)}
    elif w == "gemini":
        parts = [{"text": user}]
        if pdf:
            parts.append({"inline_data": {"mime_type": "application/pdf", "data": base64.b64encode(pdf).decode()}})
        r = _post(f"{base}/v1beta/models/{model}:generateContent", {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": parts}],
            "generationConfig": {"temperature": temperature}}, {"x-goog-api-key": key})
        try:
            text = "".join(x.get("text", "") for x in r["candidates"][0]["content"]["parts"])
        except (KeyError, IndexError, TypeError) as e:
            raise AIError(f"unexpected reply: {str(r)[:300]}") from e
        u = r.get("usageMetadata") or {}
        usage = {"in": u.get("promptTokenCount", 0), "out": u.get("candidatesTokenCount", 0)}
    else:
        content = [{"type": "text", "text": user}]
        if pdf:
            content.insert(0, {"type": "document", "source": {
                "type": "base64", "media_type": "application/pdf", "data": base64.b64encode(pdf).decode()}})
        r = _post(f"{base}/v1/messages", {
            "model": model, "max_tokens": 16000, "temperature": temperature, "system": system,
            "messages": [{"role": "user", "content": content}]},
            {"x-api-key": key, "anthropic-version": "2023-06-01"})
        text = "".join(b.get("text", "") for b in r.get("content", []) if b.get("type") == "text")
        u = r.get("usage") or {}
        usage = {"in": u.get("input_tokens", 0), "out": u.get("output_tokens", 0)}
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)  # reasoning models (qwen3, deepseek-r1) may include their thinking
    if not text.strip():
        raise AIError("the AI returned an empty answer")
    usage["seconds"] = round(time.time() - t0, 1)
    return text, usage


def image(p, prompt):
    """Returns (image bytes, usage). Gemini image models, or any OpenAI-compatible /images/generations."""
    w, base = _base(p)
    model, key = p["model"], p.get("api_key", "")
    t0 = time.time()
    if w == "gemini":
        r = _post(f"{base}/v1beta/models/{model}:generateContent", {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]}}, {"x-goog-api-key": key})
        parts = ((r.get("candidates") or [{}])[0].get("content") or {}).get("parts", [])
        data = next((x.get("inlineData") or x.get("inline_data") for x in parts if x.get("inlineData") or x.get("inline_data")), None)
        if not data:
            raise AIError(f"no picture came back (is {model!r} an image model?): {str(r)[:200]}")
        img = base64.b64decode(data["data"])
        u = r.get("usageMetadata") or {}
        usage = {"in": u.get("promptTokenCount", 0), "out": u.get("candidatesTokenCount", 0)}
    elif w == "openai":
        headers = {"Authorization": f"Bearer {key}"} if key else {}
        r = _post(f"{base}/images/generations", {"model": model, "prompt": prompt, "n": 1, "size": "1024x1024"}, headers)
        d = (r.get("data") or [{}])[0]
        if d.get("b64_json"):
            img = base64.b64decode(d["b64_json"])
        elif d.get("url"):
            with urllib.request.urlopen(d["url"], timeout=120) as f:
                img = f.read()
        else:
            raise AIError(f"no picture came back: {str(r)[:200]}")
        u = r.get("usage") or {}
        usage = {"in": u.get("input_tokens", 0), "out": u.get("output_tokens", 0)}
    else:
        raise AIError("Claude cannot draw pictures. Pick a Gemini image model or an OpenAI-compatible image server.")
    usage["seconds"] = round(time.time() - t0, 1)
    return img, usage
