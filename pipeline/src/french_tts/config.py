"""Pipeline defaults. An item's ``voice`` override in the YAML wins over these.

Placeholders until the TTS bake-off (plan steps 4–5) picks the voices and the
slow rate; the chosen values and the reasoning get recorded here.

Plain strings with no imports, so every module can use them; tests check they
are valid voice names / rates.
"""

DEFAULT_VOICE = "denise"
NORMAL_RATE = "+0%"
SLOW_RATE = "-25%"
