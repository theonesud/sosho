import logging
from pathlib import Path

from sosho_engine.errors import NodeFailedError

logger = logging.getLogger(__name__)
SKILL_FILE = "SKILL.md"


def discover_skills(skills_dir: Path) -> list[str]:
    if not skills_dir.is_dir():
        logger.warning("skills directory %s does not exist", skills_dir)
        return []
    return sorted(
        path.name
        for path in skills_dir.iterdir()
        if path.is_dir() and (path / SKILL_FILE).is_file() and not path.name.startswith(".")
    )


def link_skills(workdir: Path, skills_dir: Path, names: list[str]) -> list[Path]:
    target = workdir / ".agents" / "skills"
    target.mkdir(parents=True, exist_ok=True)
    links: list[Path] = []
    for name in names:
        source = skills_dir / name
        if not (source / SKILL_FILE).is_file():
            raise NodeFailedError(f"skill {name} is not in {skills_dir}")
        link = target / name
        link.symlink_to(source.resolve(), target_is_directory=True)
        links.append(link)
    return links
