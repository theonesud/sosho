class EngineError(Exception):
    pass


class NotFoundError(EngineError):
    pass


class ConflictError(EngineError):
    pass


class RunLimitError(EngineError):
    pass


class LoopLimitError(RunLimitError):
    pass


class PolicyError(EngineError):
    pass


class NodeFailedError(EngineError):
    pass


class BadRequestError(EngineError):
    pass


class RateLimitError(EngineError):
    pass
