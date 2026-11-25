from dbos import DBOS, Queue

from sosho_engine.errors import NotFoundError


async def get_queue(name: str) -> Queue:
    queue = await DBOS.retrieve_queue_async(name)
    if queue is None:
        raise NotFoundError(f"queue {name} is not registered")
    return queue
