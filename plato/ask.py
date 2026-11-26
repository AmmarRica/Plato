"""Optional "Ask Plato": answers questions from the saved places only.

Needs the `anthropic` package and ANTHROPIC_API_KEY in .env; hidden otherwise.
"""
import json

from . import env

DEFAULT_MODEL = "claude-opus-5-5"
SYSTEM = """You are Plato the Foodie Philosopher, the voice of a personal food map. \
Your motto: "the unexamined meal is not worth eating."

Answer using only the saved places in the JSON below. Never invent a place, and never \
recommend anything that is not in the list. If nothing saved fits, say so plainly and \
suggest what kind of place to add. Places with status "avoid" are warnings, not picks; \
"want_to_try" means not yet visited, so say that when you suggest one.

When the question mentions a location, judge closeness from the addresses and coordinates. \
Keep answers short: the best one to three places, each with a one-line reason drawn from \
the tags, notes, rating and must-order items. Plain text, no markdown tables.

Saved places:
"""
FIELDS = ("name", "address", "lat", "lng", "tags", "price", "rating", "status",
          "notes_public", "must_order")


def available():
    if not env.get("ANTHROPIC_API_KEY"):
        return False
    try:
        import anthropic  # noqa: F401
    except ImportError:
        return False
    return True


def _context(doc):
    names = {l["id"]: l["name"] for l in doc["lists"]}
    lists_of = {}
    for item in doc["list_items"]:
        lists_of.setdefault(item["place_id"], []).append(names.get(item["list_id"], ""))
    rows = []
    for place in doc["places"]:
        row = {k: place.get(k) for k in FIELDS if place.get(k) not in (None, "", [])}
        row["lists"] = lists_of.get(place["id"], [])
        rows.append(row)
    return json.dumps(rows, ensure_ascii=False)


def ask(doc, question, history=()):
    """Return Plato's answer as text. Raises RuntimeError with a readable message."""
    import anthropic

    messages = [{"role": m["role"], "content": str(m["content"])[:4000]}
                for m in list(history)[-10:]
                if m.get("role") in ("user", "assistant") and m.get("content")]
    messages.append({"role": "user", "content": str(question)[:4000]})
    client = anthropic.Anthropic(api_key=env.get("ANTHROPIC_API_KEY"))
    params = dict(model=env.get("PLATO_MODEL", DEFAULT_MODEL), max_tokens=16000,
                  system=SYSTEM + _context(doc), messages=messages,
                  output_config={"effort": "low"})
    try:
        try:
            # Server-side fallback: if a safety classifier declines, the API
            # retries on its default fallback model inside the same call.
            response = client.beta.messages.create(
                betas=["server-side-fallback-2026-07-01"], fallbacks="default", **params)
        except TypeError:                      # older SDK without `fallbacks`
            response = client.messages.create(**params)
    except anthropic.AuthenticationError as err:
        raise RuntimeError("The Claude API key in .env was rejected.") from err
    except anthropic.RateLimitError as err:
        raise RuntimeError("Claude is rate limited right now; try again shortly.") from err
    except anthropic.APIStatusError as err:
        raise RuntimeError(f"Claude API error {err.status_code}: {err.message}") from err
    except anthropic.APIConnectionError as err:
        raise RuntimeError("Could not reach the Claude API.") from err
    if response.stop_reason == "refusal":
        raise RuntimeError("Plato declined to answer that one.")
    text = "".join(block.text for block in response.content if block.type == "text").strip()
    return text or "Plato has no answer for that."
