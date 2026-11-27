class MemoryError(Exception):
    pass


class MemoryConfigError(MemoryError):
    pass


class MemoryStorageError(MemoryError):
    pass


class MemoryModelError(MemoryError):
    pass


class MemoryValidationError(MemoryError):
    pass


class SecretRejectedError(MemoryValidationError):
    pass


class UnapprovedRelationError(MemoryValidationError):
    pass
