## knowledge_search 工具使用规范

**何时用**：
- 用户询问品牌 DNA、设计风格定义、历史成功案例
- 需要服装品类分类参考（如版型、面料、工艺术语）
- 用户提到具体品牌名时，先查 brand-dna 再回答
- 需要参考成功提示词（success-prompts）辅助生图描述

**何时不用**：
- 用户询问当季流行趋势（用 web_search）
- 用户询问自己的记忆或偏好（用 memory_inspector）
- 纯闲聊，不涉及设计知识

**结果处理**：
- hits 为空时，告知用户知识库暂无相关内容，不要编造
- score < 0.75 时，降低引用置信度，明确说明"仅作参考"
- 多条 hits 命中不同集合（brand-dna / garment-taxonomy / success-prompts）时，按相关性择优引用，避免堆砌
