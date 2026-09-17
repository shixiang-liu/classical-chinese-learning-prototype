from app.graph.state import PipelineState


def build_prompt(state: PipelineState) -> str:
    content = state.get("source_text") or state["raw_input"]
    chunks = state.get("retrieved_chunks") or []
    refs = "\n".join(f"- {c}" for c in chunks[:4]) if chunks else "（无检索资料）"

    return f"""你是一位经验丰富的语文教师，请生成一份课堂教学提纲。

【教学内容】
{content}

【参考资料】
{refs}

请严格按照以下 JSON 格式输出，不要输出任何其他内容：
{{
  "title": "课堂提纲标题",
  "teaching_goals": ["目标1", "目标2", "目标3"],
  "key_points": ["重点1", "重点2"],
  "difficult_points": ["难点1", "难点2"],
  "activity_flow": [
    {{"step": 1, "name": "导入", "duration": "5分钟", "description": "活动描述"}},
    {{"step": 2, "name": "讲授", "duration": "15分钟", "description": "活动描述"}},
    {{"step": 3, "name": "练习", "duration": "15分钟", "description": "活动描述"}},
    {{"step": 4, "name": "总结", "duration": "5分钟", "description": "活动描述"}}
  ],
  "evidence_refs": ["来源1"]
}}"""
