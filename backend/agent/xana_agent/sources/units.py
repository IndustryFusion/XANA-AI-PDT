#
# Copyright (c) 2026 IndustryFusion Foundation
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#   http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
"""Units of measure as NGSI-LD's `unitCode` names them: UN/CEFACT Recommendation 20 common codes.

When the knowledge describes no units (`qudt:Unit` with `qudt:uneceCommonCode`), the explorer offers
this list: common codes of industrial measurements, each with its symbol and name.
"""

from __future__ import annotations

# (common code, symbol, name)
BUILT_IN: tuple[tuple[str, str, str], ...] = (
    ("CEL", "°C", "degree Celsius"),
    ("KEL", "K", "kelvin"),
    ("FAH", "°F", "degree Fahrenheit"),
    ("PAL", "Pa", "pascal"),
    ("KPA", "kPa", "kilopascal"),
    ("MPA", "MPa", "megapascal"),
    ("BAR", "bar", "bar"),
    ("MBR", "mbar", "millibar"),
    ("MTR", "m", "metre"),
    ("CMT", "cm", "centimetre"),
    ("MMT", "mm", "millimetre"),
    ("4H", "µm", "micrometre"),
    ("KMT", "km", "kilometre"),
    ("MTK", "m²", "square metre"),
    ("MTQ", "m³", "cubic metre"),
    ("LTR", "l", "litre"),
    ("MLT", "ml", "millilitre"),
    ("MQH", "m³/h", "cubic metre per hour"),
    ("MQS", "m³/s", "cubic metre per second"),
    ("L2", "l/min", "litre per minute"),
    ("KGM", "kg", "kilogram"),
    ("GRM", "g", "gram"),
    ("TNE", "t", "tonne"),
    ("KGH", "kg/h", "kilogram per hour"),
    ("KMQ", "kg/m³", "kilogram per cubic metre"),
    ("SEC", "s", "second"),
    ("C26", "ms", "millisecond"),
    ("MIN", "min", "minute"),
    ("HUR", "h", "hour"),
    ("DAY", "d", "day"),
    ("HTZ", "Hz", "hertz"),
    ("KHZ", "kHz", "kilohertz"),
    ("RPM", "r/min", "revolutions per minute"),
    ("MTS", "m/s", "metre per second"),
    ("MSK", "m/s²", "metre per second squared"),
    ("KMH", "km/h", "kilometre per hour"),
    ("NEW", "N", "newton"),
    ("KN", "kN", "kilonewton"),
    ("NU", "N·m", "newton metre"),
    ("WTT", "W", "watt"),
    ("KWT", "kW", "kilowatt"),
    ("MAW", "MW", "megawatt"),
    ("WHR", "W·h", "watt hour"),
    ("KWH", "kW·h", "kilowatt hour"),
    ("JOU", "J", "joule"),
    ("KJO", "kJ", "kilojoule"),
    ("VLT", "V", "volt"),
    ("KVT", "kV", "kilovolt"),
    ("2Z", "mV", "millivolt"),
    ("AMP", "A", "ampere"),
    ("4K", "mA", "milliampere"),
    ("OHM", "Ω", "ohm"),
    ("D33", "T", "tesla"),
    ("P1", "%", "percent"),
    ("59", "ppm", "part per million"),
    ("2N", "dB", "decibel"),
    ("DD", "°", "degree (angle)"),
    ("C81", "rad", "radian"),
    ("LUX", "lx", "lux"),
    ("A86", "GHz", "gigahertz"),
    ("C62", "1", "one (no unit)"),
)


def built_in() -> list[dict[str, str]]:
    return [{"code": code, "symbol": symbol, "name": name} for code, symbol, name in BUILT_IN]
