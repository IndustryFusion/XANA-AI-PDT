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
"""Declared NGSI-LD values read as their values (gh-84-read-declared-values, design D2)."""

import pytest

from xana_agent.literals import XSD, datatype, declared, literal
from xana_agent.steps import attribute_value, facts, numeric_attributes

DOUBLE = XSD + "double"


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ({"type": DOUBLE, "@value": 42.5}, 42.5),  # compacted, as the broker returns it
        ({"@type": DOUBLE, "@value": 42.5}, 42.5),  # expanded
        ({"type": DOUBLE, "@value": "42.5"}, 42.5),  # a live string merged onto a declared double
        ({"type": "xsd:double", "@value": "42.5"}, 42.5),  # compact IRI
        ({"type": XSD + "integer", "@value": "17"}, 17),
        ({"type": XSD + "boolean", "@value": "true"}, True),
        ({"type": DOUBLE, "@value": 0}, 0),
        (42.5, 42.5),  # plain values as they are
        ("00042", "00042"),  # a plain string stays a string
        ({"@value": "00042"}, "00042"),  # no datatype: the text is kept
        ({"type": DOUBLE, "@value": "hot"}, "hot"),  # not a number: the text is kept
        ({"@id": "urn:x:1"}, {"@id": "urn:x:1"}),  # IRI references as they are
        ({"en": "pump"}, {"en": "pump"}),  # not a value object
        ({"@value": 1, "unexpected": 2}, {"@value": 1, "unexpected": 2}),
    ],
)
def test_a_value_is_read_as_its_value(value, expected):
    assert literal(value) == expected
    assert type(literal(value)) is type(expected)


def test_the_datatype_is_a_full_iri():
    assert datatype({"type": "xsd:double", "@value": 1}) == DOUBLE
    assert datatype({"type": DOUBLE, "@value": 1}) == DOUBLE
    assert datatype(42.5) is None
    assert datatype({"@id": "urn:x"}) is None


def test_an_edit_keeps_the_stored_datatype():
    stored = {"type": DOUBLE, "@value": 42.5}
    assert declared(80, stored) == {"@value": 80, "@type": DOUBLE}
    assert declared(80, 42.5) == 80, "a plain stored value stays plain"
    assert declared("hot", stored) == "hot", "only numbers are declared"
    assert declared(True, stored) is True


def test_the_agent_reads_declared_values():
    entity = {
        "id": "urn:m:1",
        "type": "Machine",
        "temperature": {"type": "Property", "value": {"type": DOUBLE, "@value": "42.5"}, "unitCode": "CEL"},
        "speed": {"type": "Property", "value": 3.0},
    }
    assert attribute_value(entity["temperature"]) == 42.5
    assert facts(entity)["attributes"]["temperature"] == "42.5 CEL"
    assert sorted(numeric_attributes(entity)) == [("speed", 3.0, None), ("temperature", 42.5, "CEL")]
