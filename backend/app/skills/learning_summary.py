from app.graph.state import PipelineState


def build_prompt(state: PipelineState) -> str:
    content = state.get("source_text") or state["raw_input"]
    chunks = state.get("retrieved_chunks") or []
    refs = "\n".join(f"- {c}" for c in chunks[:3]) if chunks else "（无检索资料）"

    return f"""你是一位语文教师，请为以下学习过程生成一份学习总结。

【学习内容】
{content}

【参考资料】
{refs}

请严格按照以下 JSON 格式输出，不要输出任何其他内容：
{{
  "title": "学习总结标题",
  "what_was_learned": "本次学习主要收获（150字以内）",
  "evidence_summary": "证据链摘要：本次学习经历了哪些环节",
  "pending_questions": ["待解决问题1", "待解决问题2"],
  "evidence_refs": ["来源1"]
}}"""
