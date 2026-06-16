基于以下对话，提取用户的稳定偏好（颜色 / 客群 / 风格 / 禁忌 / 比例 / 语气）。
只输出确信的偏好（confidence ≥ 0.6）。模糊或临时的偏好不要输出。
返回一个 JSON 数组，每个元素形如：
  {{"key": "<color_preference|audience|tone|avoid|aspect_ratio|style>",
    "value": "<偏好文本>",
    "confidence": <0-1 之间数字>,
    "evidence": "<不超过 80 字的原文摘要>"}}
如果没有明确偏好，返回 []。不要输出 JSON 之外的任何文字。

对话:
{messages_serialized}
