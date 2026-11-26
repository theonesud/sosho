from pathlib import Path

import pytest
from flows import PI_ROLE
from pydantic import JsonValue, ValidationError
from sosho_engine.host_node import (
    MAX_TEXT_CHARS,
    build_argv,
    build_env,
    build_output,
    compose_prompt,
    safe_prompt,
)
from sosho_engine.jobs import NodeJob
from sosho_engine.pi_events import PiTrace
from sosho_engine.settings import Settings
from sosho_engine.spec_nodes import AgentNode, LlmNode, SkillNode
from sosho_engine.workdir import workdir_for

ROOT = Path("/opt/sosho")
HEAD = ["--raw", "-p", "--no-session", "--mode", "json", "--provider", "litellm"]


def _settings() -> Settings:
    return Settings.model_validate(
        {"api_token": "test-token-0123456789abcdef", "repo_root": ROOT, "pi_command": "pi-test"}
    )


def _job(node: AgentNode | SkillNode | LlmNode, data: dict[str, JsonValue]) -> NodeJob:
    return NodeJob(run_id="run-1", node=node, data=data, llm_left=10)


def _agent(**extra: JsonValue) -> AgentNode:
    fields: dict[str, JsonValue] = {"id": "n", "role": PI_ROLE, "prompt": "go {{input.x}}", **extra}
    return AgentNode.model_validate(fields)


def test_agent_argv_has_the_session_flags_the_role_the_extensions_and_the_prompt() -> None:
    node = _agent(instructions="Be {{input.tone}}")
    argv = build_argv(_settings(), node, _job(node, {"input": {"x": "now", "tone": "calm"}}))
    assert argv[0] == "pi-test"
    assert argv[1:8] == HEAD
    assert argv[8:10] == ["--model", PI_ROLE]
    assert argv[10:13:2] == ["-e", "-e"]
    assert [Path(item).parts[-3] for item in argv[11:14:2]] == ["guard", "langfuse"]
    assert argv[-1] == "Instructions:\nBe calm\n\nTask:\ngo now"
    assert "--append-system-prompt" not in argv


def test_agent_without_instructions_passes_the_bare_task() -> None:
    node = _agent()
    argv = build_argv(_settings(), node, _job(node, {"input": {"x": "a"}}))
    assert "--append-system-prompt" not in argv
    assert argv[-1] == "go a"


def test_the_system_prompt_flags_do_not_depend_on_the_instructions() -> None:
    plain = _agent()
    rich = _agent(instructions="Be very different")
    one = build_argv(_settings(), plain, _job(plain, {"input": {"x": "a"}}))
    two = build_argv(_settings(), rich, _job(rich, {"input": {"x": "a"}}))
    assert one[:-1] == two[:-1]


def test_skill_node_argv_names_the_skill_and_renders_the_task() -> None:
    node = SkillNode.model_validate(
        {"id": "n", "skill": "beta", "task": "do {{input.x}}", "role": PI_ROLE}
    )
    argv = build_argv(_settings(), node, _job(node, {"input": {"x": "it"}}))
    assert "--append-system-prompt" not in argv
    assert argv[-1] == "Instructions:\nUse the skill beta for this task.\n\nTask:\ndo it"


def test_llm_node_argv_turns_tools_skills_and_context_files_off() -> None:
    node = LlmNode.model_validate(
        {"id": "n", "role": PI_ROLE, "prompt": "hi {{input.x}}", "system": "Be brief"}
    )
    argv = build_argv(_settings(), node, _job(node, {"input": {"x": "there"}}))
    assert {"--no-tools", "--no-skills", "--no-context-files"} <= set(argv)
    assert argv[argv.index("--model") + 1] == PI_ROLE
    assert "--append-system-prompt" not in argv
    assert argv[-1] == "Instructions:\nBe brief\n\nTask:\nhi there"


def test_a_task_that_looks_like_an_option_stays_behind_the_instructions_heading() -> None:
    assert compose_prompt("Be brief", "-x") == "Instructions:\nBe brief\n\nTask:\n-x"


@pytest.mark.parametrize("prompt", ["-x", "@file"])
def test_a_prompt_that_looks_like_an_option_gets_a_leading_space(prompt: str) -> None:
    assert safe_prompt(prompt) == f" {prompt}"
    assert safe_prompt("plain") == "plain"


def test_env_has_the_root_the_warmup_switch_and_the_trace_ids() -> None:
    env = build_env(_settings(), _job(_agent(), {}))
    assert env["PI_SKIP_WARMUP"] == "1"
    assert env["SOSHO_ROOT"] == str(ROOT)
    assert env["SOSHO_PI_STATE"] == "root"
    assert env["LANGFUSE_PI_PARENT_SESSION_ID"] == "run-1"
    assert len(env["LANGFUSE_PI_PARENT_TRACE_ID"]) == 32
    assert len(env["LANGFUSE_PI_PARENT_SPAN_ID"]) == 16


def test_default_pi_command_is_the_launcher_in_the_repository() -> None:
    settings = Settings.model_validate(
        {"api_token": "test-token-0123456789abcdef", "repo_root": ROOT}
    )
    assert settings.pi_path() == str(ROOT / "bin" / "pi-launcher.sh")


def test_workdir_is_below_the_runs_directory(tmp_path: Path) -> None:
    assert workdir_for(tmp_path, "run-1", "n").is_relative_to(tmp_path)


def test_output_text_above_the_cap_is_cut_and_marked() -> None:
    trace = PiTrace()
    trace.text = "y" * (MAX_TEXT_CHARS + 10)
    output = build_output(trace, _agent(), 0.0, "/work")
    assert len(str(output["text"])) == MAX_TEXT_CHARS
    assert output["truncated"] is True
    assert output["role"] == PI_ROLE


def test_unset_thinking_passes_no_thinking_flag() -> None:
    for node in (
        _agent(),
        SkillNode.model_validate({"id": "n", "skill": "beta", "task": "t", "role": PI_ROLE}),
        LlmNode.model_validate({"id": "n", "role": PI_ROLE, "prompt": "p"}),
    ):
        assert "--thinking" not in build_argv(_settings(), node, _job(node, {}))


@pytest.mark.parametrize("level", ["off", "minimal", "low", "medium", "high", "xhigh", "max"])
def test_agent_thinking_passes_the_level_after_the_model(level: str) -> None:
    node = _agent(thinking=level)
    argv = build_argv(_settings(), node, _job(node, {"input": {"x": "a"}}))
    assert argv[argv.index("--model") + 2 : argv.index("--model") + 4] == ["--thinking", level]


def test_skill_and_llm_nodes_pass_thinking() -> None:
    skill = SkillNode.model_validate(
        {"id": "n", "skill": "beta", "task": "t", "role": PI_ROLE, "thinking": "low"}
    )
    llm = LlmNode.model_validate({"id": "n", "role": PI_ROLE, "prompt": "p", "thinking": "off"})
    assert build_argv(_settings(), skill, _job(skill, {}))[10:12] == ["--thinking", "low"]
    argv = build_argv(_settings(), llm, _job(llm, {}))
    assert argv[argv.index("--thinking") + 1] == "off"


@pytest.mark.parametrize("value", ["none", "OFF", "", 3, True])
def test_a_bad_thinking_value_is_rejected(value: JsonValue) -> None:
    with pytest.raises(ValidationError, match="thinking"):
        _agent(thinking=value)
    with pytest.raises(ValidationError, match="thinking"):
        SkillNode.model_validate(
            {"id": "n", "skill": "beta", "task": "t", "role": PI_ROLE, "thinking": value}
        )
    with pytest.raises(ValidationError, match="thinking"):
        LlmNode.model_validate({"id": "n", "role": PI_ROLE, "prompt": "p", "thinking": value})
