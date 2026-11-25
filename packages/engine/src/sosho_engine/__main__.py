import logging

import uvicorn

from sosho_engine.api_app import create_app
from sosho_engine.lifecycle import build_runtime
from sosho_engine.models import litellm_models
from sosho_engine.settings import Settings


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings = Settings()
    app = create_app(build_runtime(settings, litellm_models(settings)))
    uvicorn.run(app, host=settings.host, port=settings.port, log_level="info")


if __name__ == "__main__":
    main()
