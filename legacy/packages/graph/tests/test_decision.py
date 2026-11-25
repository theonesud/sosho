from sosho_graph.nodes.decision import parse_branch

BRANCHES = ["quick", "deep"]


def test_parse_branch_reads_valid_json_branch() -> None:
    assert parse_branch('{"branch": "deep", "reason": "long"}', BRANCHES) == "deep"


def test_parse_branch_uses_first_branch_for_unknown_json_branch() -> None:
    assert parse_branch('{"branch": "other"}', BRANCHES) == "quick"


def test_parse_branch_finds_branch_name_in_plain_text() -> None:
    assert parse_branch("I pick Deep for this.", BRANCHES) == "deep"


def test_parse_branch_uses_first_branch_when_no_name_matches() -> None:
    assert parse_branch("no idea", BRANCHES) == "quick"
