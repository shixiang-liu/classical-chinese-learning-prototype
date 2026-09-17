from app.graph.state import PipelineState

_DIRECT_ANSWER_KEYWORDS = (
    "直接给答案",
    "直接告诉我答案",
    "给我答案",
    "完整答案",
    "标准答案",
    "别提示了",
    "不要提示",
)

_HOLD_BACK_ANSWER_KEYWORDS = (
    "不要直接给答案",
    "别直接给答案",
    "先别给答案",
    "不要告诉我答案",
    "不要马上给答案",
)

_STEP_UP_KEYWORDS = (
    "提示",
    "思路",
    "怎么想",
    "一步一步",
    "引导",
    "再讲",
    "再说",
)

_CONFUSED_KEYWORDS = (
    "还是不懂",
    "没懂",
    "看不懂",
    "更具体",
    "详细一点",
    "再详细",
    "再直白",
    "再明显",
)

_FACT_QUESTION_KEYWORDS = (
    "作者是谁",
    "谁写的",
    "哪位诗人",
    "哪个朝代",
    "什么朝代",
)


def infer_hint_level(state: PipelineState) -> str:
    question = str(state.get("raw_input") or "").strip()
    history = state.get("history_messages") or []
    assistant_turns = sum(
        1
        for item in history[-6:]
        if item.get("role") == "assistant" and str(item.get("text") or "").strip()
    )

    if any(keyword in question for keyword in _HOLD_BACK_ANSWER_KEYWORDS):
        if any(keyword in question for keyword in _CONFUSED_KEYWORDS) or assistant_turns >= 1:
            return "hint_2"
        return "hint_1"
    if any(keyword in question for keyword in _DIRECT_ANSWER_KEYWORDS):
        return "answer"
    if any(keyword in question for keyword in _CONFUSED_KEYWORDS) or assistant_turns >= 2:
        return "hint_3"
    if assistant_turns >= 1 or any(keyword in question for keyword in _STEP_UP_KEYWORDS):
        return "hint_2"
    return "hint_1"


def _render_source_text(source_text: str | None) -> str:
    if not source_text:
        return "（无材料原文）"
    lines = [line.strip() for line in source_text.splitlines() if line.strip()]
    return "\n".join(lines[:12]) if lines else "（无材料原文）"


def _render_history(history: list[dict[str, str]]) -> str:
    rendered_history: list[str] = []
    for item in history[-6:]:
        role = "学生" if item.get("role") == "user" else "老师"
        text = (item.get("text") or "").strip()
        if text:
            rendered_history.append(f"{role}：{text}")
    if not rendered_history:
        return ""
    return "\n最近对话：\n" + "\n".join(rendered_history)


def build_prompt(state: PipelineState) -> str:
    question = str(state.get("raw_input") or "").strip()
    source_text = _render_source_text(state.get("source_text"))
    chunks = state.get("retrieved_chunks") or []
    refs = "\n".join(f"- {chunk}" for chunk in chunks[:3]) if chunks else "（无检索资料）"
    hint_level = infer_hint_level(state)
    history_block = _render_history(state.get("history_messages") or [])

    level_instruction = {
        "hint_1": "只指出应该抓住的词句、意象或关系，不直接说结论。",
        "hint_2": "给出关键词句或半步提示，继续引导学生自己想。",
        "hint_3": "给出接近答案的解题框架，但把最后结论留给学生补出来。",
        "answer": "可以直接给结论，但要顺手点出依据，并让学生自己复述一遍。",
    }[hint_level]

    return f"""你是面向中小学生的语文助教，要像老师一样带着学生思考，而不是机械贴模板。
当前提示等级：{hint_level}
等级要求：{level_instruction}

回答要求：
1. 只输出给学生看的自然中文，不要 JSON，不要代码块。
2. 不要复述规则，不要出现“下面给出”“请严格按照”“输出如下”这类套话。
3. 不要写“解题思路”“示范讲解”“学生：”“老师：”或编号列表。
4. 先点出学生该抓住哪里，再给一个推动思考的问题。
5. 控制在 2 段以内，80 到 140 个汉字。
6. 如果当前等级是 answer，可以先给结论，再用 1 到 2 句说清依据，最后给一句自查提示。

学生问题：
{question}

学习材料：
{source_text}

参考资料：
{refs}{history_block}"""


def build_general_prompt(state: PipelineState) -> str:
    question = str(state.get("raw_input") or "").strip()
    source_text = _render_source_text(state.get("source_text"))
    history_block = _render_history(state.get("history_messages") or [])

    material_block = ""
    if state.get("source_text"):
        material_block = f"\n课程材料：\n{source_text}"

    if any(keyword in question for keyword in _FACT_QUESTION_KEYWORDS):
        return f"""你是一个中文学习助理。
这次是简单事实题，请直接短答。
回答要求：
1. 第一短句直接给事实答案。
2. 最多再补一句极短背景，不要展开讲解。
3. 不要写角色标签、思考过程、分析步骤或反问。
4. 总长度控制在 30 个汉字以内。
{history_block}{material_block}

用户问题：
{question}"""

    return f"""你是一个中文学习助理。优先回答用户这一次的问题；如果课程材料里有相关信息，就顺手结合材料回答。
回答要求：
1. 只输出自然中文，不要 JSON、代码块、规则说明或客套结尾。
2. 先直接回答，再补 1 到 2 句简短说明。
3. 如果问题和材料强相关，尽量点出材料里的关键词句。
{history_block}{material_block}

用户问题：
{question}"""
