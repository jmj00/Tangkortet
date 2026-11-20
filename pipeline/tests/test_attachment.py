import pytest

from pipeline.attachment import classify


@pytest.mark.parametrize(
    ("record", "expected"),
    [
        ({"occurrenceRemarks": "Tørret sukkertang i opskyl"}, "drift"),
        ({"occurrenceRemarks": "Opskyl.", "depth": 3}, "drift"),
        ({"habitat": "Washed up after storm"}, "drift"),
        ({"depth": 9.0}, "attached"),
        ({"depth": "7,5"}, "attached"),
        ({"fieldNotes": "Scuba diving;"}, "attached"),
        ({"occurrenceRemarks": "fastsiddende på sten"}, "attached"),
        ({"habitat": "Beach"}, "drift"),
        ({"habitat": "Beach", "depth": 1}, "attached"),
        ({"locality": "Henne Strand"}, "drift"),
        ({"depth": 0}, "unknown"),
        ({"habitat": "Harbour"}, "unknown"),
        ({}, "unknown"),
        ({"depth": "n/a"}, "unknown"),
    ],
)
def test_classify(record, expected):
    assert classify(record) == expected
