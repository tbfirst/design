from abc import ABC, abstractmethod
from typing import Any


class AbstractProvider(ABC):
    """所有 AI Provider 的统一抽象。"""

    @abstractmethod
    async def generate_text(self, model: str, prompt: str, **kwargs: Any) -> dict[str, Any]:
        ...

    @abstractmethod
    async def generate_image(self, model: str, prompt: str, **kwargs: Any) -> dict[str, Any]:
        ...
