from app.graph.state import PipelineState


def build_prompt(state: PipelineState) -> str:
    content = state.get("source_text") or state["raw_input"]
    chunks = state.get("retrieved_chunks") or []
    refs = "\n".join(f"- {c}" for c in chunks[:3]) if chunks else "（无检索资料）"

    return f"""你是一位语文教师，请为以下内容生成一张简洁的复习卡片。

【复习内容】
{content}

【参考资料】
{refs}

请严格按照以下 JSON 格式输出，不要输出任何其他内容：
{{
  "title": "复习卡标题",
  "memory_points": ["要点1", "要点2", "要点3"],
  "confusion_points": ["易错点1", "易错点2"],
  "next_actions": ["建议1", "建议2"],
  "evidence_refs": ["来源1"]
}}"""
