# ruff: noqa

from uuid import uuid4

from app.models.agents import Agent
from app.services.mentions import extract_mentions, matches_agent_mention


def _agent(name: str, *, is_board_lead: bool = False) -> Agent:
    return Agent(name=name, gateway_id=uuid4(), is_board_lead=is_board_lead)


def test_extract_mentions_parses_tokens():
    assert extract_mentions("hi @Alex and @bob-2") == {"alex", "bob-2"}


def test_extract_mentions_supports_unicode_chinese():
    assert extract_mentions("hi @商品详情PM and @导购PM") == {"商品详情pm", "导购pm"}
    assert extract_mentions("@交易PM 请检查") == {"交易pm"}
    assert extract_mentions("@小二后台PM@发布端PM") == {"小二后台pm", "发布端pm"}
    # 测试标点符号边界
    assert extract_mentions("Hello @商品详情PM.") == {"商品详情pm"}
    assert extract_mentions("Hello @Alex.") == {"alex"}
    assert extract_mentions("@A、@B、@C") == {"a", "b", "c"}
    assert extract_mentions("@交易PM！请检查") == {"交易pm"}
    assert extract_mentions("@交易PM，请检查") == {"交易pm"}


def test_matches_agent_mention_matches_first_name():
    agent = _agent("Alice Cooper")
    assert matches_agent_mention(agent, {"alice"}) is True
    assert matches_agent_mention(agent, {"cooper"}) is False


def test_matches_agent_mention_no_mentions_is_false():
    agent = _agent("Alice")
    assert matches_agent_mention(agent, set()) is False


def test_matches_agent_mention_empty_agent_name_is_false():
    agent = _agent("   ")
    assert matches_agent_mention(agent, {"alice"}) is False


def test_matches_agent_mention_matches_full_normalized_name():
    agent = _agent("Alice Cooper")
    assert matches_agent_mention(agent, {"alice cooper"}) is True


def test_matches_agent_mention_supports_reserved_lead_shortcut():
    lead = _agent("Riya", is_board_lead=True)
    other = _agent("Lead", is_board_lead=False)
    assert matches_agent_mention(lead, {"lead"}) is True
    assert matches_agent_mention(other, {"lead"}) is False


def test_matches_agent_mention_supports_chinese_names():
    agent = _agent("商品详情PM")
    assert matches_agent_mention(agent, {"商品详情pm"}) is True
    # extract_mentions always lowercases, so mixed-case won't appear in practice
    assert matches_agent_mention(agent, {"商品详情PM"}) is False


def test_matches_agent_mention_chinese_full_name_match():
    agent = _agent("导购PM")
    assert matches_agent_mention(agent, {"导购pm"}) is True
    # Chinese names don't have spaces, so full name matching works the same
    assert matches_agent_mention(agent, {"导购"}) is False


def test_matches_agent_mention_mixed_chinese_english():
    agent = _agent("度假标准库PM")
    assert matches_agent_mention(agent, {"度假标准库pm"}) is True
    assert matches_agent_mention(agent, {"度假标准库"}) is False


def test_extract_mentions_supports_japanese():
    assert extract_mentions("@ユーザー 请检查") == {"ユーザー"}
    assert extract_mentions("@田中 @鈴木") == {"田中", "鈴木"}


def test_extract_mentions_handles_special_chars():
    # 支持连字符和下划线
    assert extract_mentions("@bob-2 and @alice_cooper") == {"bob-2", "alice_cooper"}
    # 邮箱格式会匹配 @ 符号前的部分
    assert extract_mentions("@user@domain.com") == {"user", "domain"}


def test_extract_mentions_respects_length_limit():
    # 32 字符以内应该可以匹配
    long_name = "a" * 32
    assert extract_mentions(f"@{long_name} end") == {long_name}
    # 超过 32 字符 — the pattern matches the max {1,32} greedy
    # but without a valid boundary after 32 chars, longer runs may not match
    very_long_name = "a" * 35
    # The regex needs a valid boundary (space, punctuation, or end-of-string) after the match.
    # "aaa...a" (35 chars) with lookahead checking char 33 finds another "a" which doesn't match,
    # so no match is produced. This is acceptable behavior.
    assert extract_mentions(f"@{very_long_name}") == set()
