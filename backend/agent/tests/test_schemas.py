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
import pytest
from pydantic import ValidationError

from xana_agent.schemas import HypothesisDraft, HypothesisList, ValidatedHypothesis, normalise_confidence


@pytest.mark.parametrize(
    ("given", "expected"),
    [(0.7, 0.7), (70, 0.7), ("70", 0.7), (-0.2, 0.0), (250, 1.0), (1, 1.0), (0, 0.0), (100, 1.0)],
)
def test_confidence_normalisation(given, expected):
    assert normalise_confidence(given) == pytest.approx(expected)


def test_model_answers_normalise_their_confidence():
    assert HypothesisDraft(title="t", confidence=70, evidence=[]).confidence == pytest.approx(0.7)
    validated = ValidatedHypothesis(id="h1-1", verdict="plausible", confidence=250, validation="")
    assert validated.confidence == 1.0


def test_fewer_than_two_hypotheses_do_not_match_the_structure():
    with pytest.raises(ValidationError):
        HypothesisList(hypotheses=[{"title": "t", "confidence": 0.5, "evidence": []}])


def test_unknown_verdict_does_not_match_the_structure():
    with pytest.raises(ValidationError):
        ValidatedHypothesis(id="h1-1", verdict="likely", confidence=0.5, validation="")
