import logging
import sys

import uvicorn

from sosho_engine import worker
from sosho_engine.api_app import create_app
from sosho_engine.lifecycle import build_runtime
from sosho_engine.models import litellm_models
from sosho_engine.settings import Settings

USAGE = "usage: python -m sosho_engine [serve|worker]"


def serve() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings = Settings()
    logging.getLogger(__name__).info(
        "engine starting executor=%s app_version=%s", settings.executor_id, settings.app_version
    )
    app = create_app(build_runtime(settings, litellm_models(settings)))
    uvicorn.run(app, host=settings.host, port=settings.port, log_level="info")


def main(argv: list[str]) -> int:
    command = argv[0] if argv else "serve"
    if command == "serve":
        serve()
    elif command == "worker":
        worker.main()
    else:
        sys.stderr.write(USAGE + "\n")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
