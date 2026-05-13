import pytest


@pytest.fixture(autouse=True)
def enable_operational(monkeypatch):
    monkeypatch.setenv("PLANNER_V3_OPERATIONAL", "1")


def test_filter_pieces_by_location():
    from app.services.planner_v3.island_operational_plan import filter_pieces_by_location

    pieces = [
        {"id": 1, "building": "T1", "floor": "2", "flat": "305"},
        {"id": 2, "building": "T1", "floor": "2", "flat": "306"},
        {"id": 3, "building": "T2", "floor": "1", "flat": "101"},
    ]
    assert len(filter_pieces_by_location(pieces, [], [], [])) == 3
    assert [p["id"] for p in filter_pieces_by_location(pieces, ["T1"], [], [])] == [1, 2]
    assert [p["id"] for p in filter_pieces_by_location(pieces, ["T1"], ["2"], ["305"])] == [1]


def test_build_island_operational_review_requires_flag(monkeypatch):
    monkeypatch.delenv("PLANNER_V3_OPERATIONAL", raising=False)
    from app.services.planner_v3.island_operational_plan import build_island_operational_review

    with pytest.raises(ValueError, match="PLANNER_V3_OPERATIONAL"):
        build_island_operational_review({}, [], {})
