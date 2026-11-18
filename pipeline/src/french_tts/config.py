"""Pipeline defaults. An item's ``voice`` override in the YAML wins over these.

Chosen at the TTS bake-off checkpoint (plan steps 4–5, 2026-11-18): all four
candidates (denise, henri, vivienne, remy) handled liaison, elision, silent
-ent, plus/tous, 70–99 and numerals without audible errors, so the pick is
about variety:

- Items alternate between Denise (female) and Henri (male) so the ear gets
  used to more than one voice. Both are the standard fr-FR voices; the
  multilingual ones (vivienne, remy) risk an English reading of loanwords.
- The slow replay is -25%: about 1.29× the normal length in practice, and
  still natural.

Plain strings with no imports, so every module can use them; tests check they
are valid voice names / rates.
"""

ITEM_VOICES = ("denise", "henri")  # alternated item by item
DEFAULT_VOICE = ITEM_VOICES[0]  # for one-off runs such as the tts CLI
NORMAL_RATE = "+0%"
SLOW_RATE = "-25%"
