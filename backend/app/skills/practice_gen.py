from app.graph.state import PipelineState


def build_prompt(state: PipelineState) -> str:
    grade_map = {
        "primary": "小学",
        "junior": "初中",
        "senior": "高中",
    }
    grade = grade_map.get(state.get("age_stage", "junior"), "初中")
    content = state.get("source_text") or state["raw_input"]
    chunks = state.get("retrieved_chunks") or []
    refs = "\n".join(f"- {c}" for c in chunks[:4]) if chunks else "（无检索资料）"

    return f"""你是一位语文教师，请为{grade}学生围绕以下内容生成一份练习单。

【教学内容】
{content}

【参考资料】
{refs}

请严格按照以下 JSON 格式输出，不要输出任何其他内容：
{{
  "title": "练习单标题",
  "target_skills": ["技能1", "技能2"],
  "questions": [
    {{"id": 1, "type": "填空", "question": "题目内容", "answer": "参考答案"}},
    {{"id": 2, "type": "简答", "question": "题目内容", "answer": "参考答案"}},
    {{"id": 3, "type": "赏析", "question": "题目内容", "answer": "参考答案"}}
  ],
  "answer_policy": "练习后展示答案",
  "evidence_refs": ["来源1"]
}}"""
