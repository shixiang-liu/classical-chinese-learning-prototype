from app.graph.state import PipelineState


def build_prompt(state: PipelineState) -> str:
    question = str(state.get("raw_input") or "").strip()
    source_text = str(state.get("source_text") or "").strip() or "（无材料原文）"
    chunks = state.get("retrieved_chunks") or []
    refs = "\n".join(f"- {c}" for c in chunks[:4]) if chunks else "（无检索资料）"
    role = state["role"]
    hint_note = "" if role == "teacher" else "学生端：`hint_ladder.answer` 也应保持启发式表达，不直接给标准答案。"

    return f"""你是一位语文教师，请根据学生问题和学习材料生成结构化题目解析。{hint_note}

要求：
1. 只输出一个 JSON 对象，不要代码块，不要额外解释。
2. `analysis_steps` 固定写 3 步，每步一句话，尽量短而明确。
3. `hint_ladder` 要体现从浅到深的提示，不要一上来把答案说透。
4. 如果没有检索资料，`evidence_refs` 也至少填写 `["source-text"]`。

【学生问题】
{question}

【学习材料】
{source_text}

【参考资料】
{refs}

JSON 格式：
{{
  "title": "题目解析标题",
  "question_text": "{question[:100]}",
  "analysis_steps": ["步骤1：审题", "步骤2：分析", "步骤3：作答"],
  "hint_ladder": {{
    "hint_1": "方向提示",
    "hint_2": "关键词提示",
    "hint_3": "框架提示",
    "answer": "完整解析或答案"
  }},
  "evidence_refs": ["来源1"]
}}"""
