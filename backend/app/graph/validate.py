import re

from pydantic import ValidationError
from app.graph.generate import _extract_json
from app.graph.state import PipelineState
from app.models import RESULT_SCHEMAS
from app.skills.guided_explain import infer_hint_level


def _trim_obvious_repetition(text: str) -> str:
    cleaned = text.strip()
    if len(cleaned) < 40:
        return cleaned

    max_prefix = len(cleaned) // 2
    for size in range(max_prefix, 11, -1):
        block = cleaned[:size]
        if cleaned.startswith(block * 2):
            return block.strip()

    for anchor_size in (16, 12, 8):
        if len(cleaned) <= anchor_size * 3:
            continue
        anchor = cleaned[:anchor_size]
        repeat_at = cleaned.find(anchor, anchor_size)
        if repeat_at >= anchor_size * 2:
            return cleaned[:repeat_at].strip()
    return cleaned


def _strip_common_tail(text: str) -> str:
    cleaned = text.strip()
    tail_patterns = [
        r'如果还有其他问题，可以继续提问。?$',
        r'如果你还有其他问题，可以继续提问。?$',
        r'如有其他问题，可以继续提问。?$',
        r'欢迎继续提问。?$',
        r'可以继续提问。?$',
    ]
    for pattern in tail_patterns:
        cleaned = re.sub(pattern, '', cleaned).strip()
    return cleaned


def _strip_common_head(text: str) -> str:
    cleaned = text.strip()
    head_patterns = [
        r'^请严格遵循上述要求.*$',
        r'^请严格按.*$',
        r'^请严格按照.*$',
        r'^输出要求[:：].*$',
        r'^回答要求[:：].*$',
    ]
    lines = [line.strip() for line in cleaned.splitlines()]
    while lines:
        first = lines[0]
        if not first:
            lines.pop(0)
            continue
        if any(re.match(pattern, first) for pattern in head_patterns):
            lines.pop(0)
            continue
        break
    return "\n".join(lines).strip()


def _strip_prompt_leak_sections(text: str) -> str:
    cleaned = text.strip()
    leak_patterns = (
        r'(?im)^\s*(recent conversation|lesson material|course material|student question|user question|answer|system answer|follow[- ]?up)\s*[:：]',
        r'(?im)^\s*(最近对话|课程材料|课堂材料|学生问题|用户问题|系统回答|回答|补充材料)\s*[:：]',
    )
    cut_index: int | None = None
    for pattern in leak_patterns:
        match = re.search(pattern, cleaned)
        if match and (cut_index is None or match.start() < cut_index):
            cut_index = match.start()
    if cut_index is not None:
        cleaned = cleaned[:cut_index].strip()
    return cleaned


def _clean_student_display_text(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith('```json'):
        cleaned = cleaned[len('```json'):].strip()
    if cleaned.startswith('```'):
        cleaned = cleaned[3:].strip()
    if cleaned.endswith('```'):
        cleaned = cleaned[:-3].strip()
    cleaned = _strip_common_head(cleaned)
    cleaned = _strip_prompt_leak_sections(cleaned)
    cleaned = re.split(r'本任务思考路径[:：]', cleaned, maxsplit=1)[0].strip()
    cleaned = re.split(r'思考路径[:：]', cleaned, maxsplit=1)[0].strip()
    cleaned = re.split(r'【任务分析】', cleaned, maxsplit=1)[0].strip()
    cleaned = re.split(r'任务分析[:：]', cleaned, maxsplit=1)[0].strip()
    cleaned = re.split(r'本任务聚焦', cleaned, maxsplit=1)[0].strip()
    cleaned = _trim_obvious_repetition(cleaned)
    cleaned = _strip_common_tail(cleaned)
    blocked_line_prefixes = (
        '学生困惑：',
        '本任务思考路径：',
        '思考路径：',
        '【任务分析】',
        '任务分析：',
        '本任务聚焦',
        '推理过程：',
        '内部分析：',
        '教师：',
        '老师：',
        '学生：',
    )
    lines = [line.strip() for line in cleaned.splitlines() if line.strip()]
    lines = [line for line in lines if not any(line.startswith(prefix) for prefix in blocked_line_prefixes)]
    cleaned = '\n'.join(lines).strip()
    cleaned = re.sub(r'(教师|老师|学生)[:：]\s*', '', cleaned).strip()
    cleaned = re.sub(r'^[，。；：、,\.\s]+', '', cleaned).strip()
    return cleaned.strip()


def _is_brief_greeting(state: PipelineState) -> bool:
    raw_input = re.sub(r'\s+', ' ', str(state.get('raw_input') or '').strip().lower())
    if not raw_input or state.get('source_text') or state.get('history_messages'):
        return False
    return raw_input in {'hi', 'hello', 'hey', '你好', '您好', '嗨', '哈喽', '在吗', '在嗎'}


def _build_greeting_general_chat_payload(state: PipelineState) -> dict:
    return {
        'title': _build_general_chat_title(state, str(state.get('raw_input') or '').strip()),
        'answer': '你好，我在。你可以直接发诗句、题目，或者告诉我哪一句没懂。',
        'follow_up': None,
        'evidence_refs': ['general-chat-greeting'],
    }


def _looks_like_prompt_template(text: str) -> bool:
    markers = (
        '"analysis_steps"',
        '"hint_ladder"',
        '"question_text"',
        '"teaching_goals"',
        '题目解析标题',
        '课堂提纲标题',
        '请严格按照',
        '请严格遵循',
    )
    return sum(1 for marker in markers if marker in text) >= 2


def _compact_guided_explain_text(text: str) -> str:
    cleaned = _clean_student_display_text(text)
    if not cleaned:
        return cleaned

    cleaned = re.sub(r'^(解题思路|示范讲解|答题思路|参考讲解)[:：]\s*', '', cleaned).strip()
    cleaned = re.sub(r'\n{3,}', '\n\n', cleaned)

    blocked_markers = ('学生问题：', '学生：', '老师：', '【解题步骤示范】', '【答题步骤】')
    blocked_prefixes = ('本题考查', '参考答案', '答案：', '完整答案')
    paragraphs = [part.strip() for part in re.split(r'\n\s*\n', cleaned) if part.strip()]
    kept = [
        part for part in paragraphs
        if not any(marker in part for marker in blocked_markers)
        and not any(part.startswith(prefix) for prefix in blocked_prefixes)
    ]

    compact = '\n\n'.join(kept[:2] if kept else paragraphs[:1]).strip()
    if len(compact) > 220:
        compact = compact[:220].rstrip('，、；： ')
    return compact.strip()


_GENERIC_GENERAL_CHAT_TITLES = {'普通对话', '当前主题', '当前会话', '未命名会话', 'general chat'}


def _clean_general_chat_title_candidate(value: str | None, *, max_length: int = 18) -> str:
    cleaned = re.sub(r'\s+', ' ', str(value or '')).strip().strip("\"'“”‘’")
    cleaned = re.sub(r'^(请问一下|请问|我想问一下|我想问|想问一下|帮我看看|帮我|请你|请帮我)\s*', '', cleaned)
    cleaned = re.sub(r'[。！？!?；;：:，,、]+$', '', cleaned).strip()
    if not cleaned:
        return ''
    if cleaned.lower() in _GENERIC_GENERAL_CHAT_TITLES:
        return ''
    if len(cleaned) <= max_length:
        return cleaned
    return f'{cleaned[:max_length].rstrip()}...'


def _build_general_chat_title(state: PipelineState, *candidates: str | None) -> str:
    for candidate in candidates:
        cleaned = _clean_general_chat_title_candidate(candidate, max_length=18)
        if cleaned:
            return cleaned

    raw_input = _clean_general_chat_title_candidate(str(state.get('raw_input') or '').strip(), max_length=18)
    if raw_input:
        return raw_input

    history = state.get('history_messages') or []
    for item in history:
        if not isinstance(item, dict):
            continue
        if item.get('role') != 'user':
            continue
        cleaned = _clean_general_chat_title_candidate(str(item.get('text') or '').strip(), max_length=18)
        if cleaned:
            return cleaned

    return '普通对话'


def _pick_focus_snippet(state: PipelineState) -> str:
    raw_input = str(state.get('raw_input') or '').strip()
    quoted = re.search(r'[“"]([^”“"\n]{2,24})[”"]', raw_input)
    if quoted:
        return quoted.group(1).strip()

    source_text = str(state.get('source_text') or '').strip()
    lines = [line.strip() for line in source_text.splitlines() if line.strip()]
    for line in reversed(lines):
        if line.startswith('《') and line.endswith('》'):
            continue
        if 2 <= len(line) <= 24:
            return line
    return '关键句'


def _build_guided_explain_fallback_text(state: PipelineState, hint_level: str) -> str:
    question = str(state.get('raw_input') or '').strip()
    focus = _pick_focus_snippet(state)

    if any(word in question for word in ('感情', '情感', '心情', '思想')):
        if hint_level == 'answer':
            return f'这类题先抓最能透出情感的句子。像“{focus}”这样的地方，往往不是只写景，而是借景带出人物心情。你可以用“先写……再转到……，表达了……”这样的句式作答。'
        return f'先别急着说情感名称，先看“{focus}”写的是眼前景，还是由景转到心里想法。想清这一步，你就离答案很近了。'

    if any(word in question for word in ('修辞', '手法', '作用', '表达效果')):
        if hint_level == 'answer':
            return f'先看“{focus}”是不是把一种事物当成另一种来写，或者用了特别突出的表达方式。答题时可以用“这里运用了……，把……写得更……”这样的句式。'
        return f'盯住“{focus}”这句想一想：作者是不是把一种东西写成了另一种，或者故意强化了某个感觉？先说出这个关系，再判断手法。'

    if hint_level == 'answer':
        return f'这道题不要只抄原句，先抓“{focus}”这样的关键信息，再用“写了什么 + 为什么这样写 + 表达了什么”三个部分组织答案。'
    return f'先抓住“{focus}”这样的关键句，别急着整段翻译。你先说说它写了什么、和前后句是什么关系，再往下推就顺了。'


def _build_guided_explain_next_hint(state: PipelineState, hint_level: str) -> str | None:
    question = str(state.get('raw_input') or '').strip()
    focus = _pick_focus_snippet(state)

    if hint_level == 'answer':
        return '你可以试着不用原句，自己复述一遍理由。'
    if any(word in question for word in ('感情', '情感', '心情', '思想')):
        return f'再想想“{focus}”更像是在写景，还是在借景说心情。'
    if any(word in question for word in ('修辞', '手法', '作用', '表达效果')):
        return f'再想想“{focus}”是不是把两样东西联系在一起写了。'
    return '你可以先说出最关键的词句，再说它为什么重要。'


def _coerce_guided_explain_payload(raw_output: str, state: PipelineState) -> dict:
    hint_level = infer_hint_level(state)
    title = '引导讲解'
    content_anchor = state.get('content_anchor') or {}
    if isinstance(content_anchor, dict):
        anchor_title = str(content_anchor.get('title') or '').strip()
        if anchor_title:
            title = f'《{anchor_title}》引导讲解'

    next_challenge_hint = _build_guided_explain_next_hint(state, hint_level)
    evidence_refs = ['source-text'] if state.get('source_text') else ['model-raw-output']

    try:
        payload = _extract_json(raw_output)
    except Exception:
        payload = None

    if isinstance(payload, dict):
        hint_text = _compact_guided_explain_text(
            str(
                payload.get('hint_content')
                or payload.get('answer')
                or ((payload.get('hint_ladder') or {}).get(hint_level) if isinstance(payload.get('hint_ladder'), dict) else '')
                or ((payload.get('hint_ladder') or {}).get('hint_1') if isinstance(payload.get('hint_ladder'), dict) else '')
                or ''
            )
        )
        if not hint_text or _looks_like_prompt_template(hint_text):
            hint_text = _build_guided_explain_fallback_text(state, hint_level)
        next_challenge_hint = str(payload.get('next_challenge_hint') or next_challenge_hint or '').strip() or None
        evidence_refs = payload.get('evidence_refs') or evidence_refs
        return {
            'title': str(payload.get('title') or title).strip() or title,
            'bloom_level': str(payload.get('bloom_level') or state.get('bloom_level') or 'understand'),
            'current_hint_level': str(payload.get('current_hint_level') or hint_level),
            'hint_content': hint_text,
            'next_challenge_hint': next_challenge_hint,
            'evidence_refs': evidence_refs,
        }

    cleaned = _compact_guided_explain_text(raw_output)
    if not cleaned or _looks_like_prompt_template(cleaned):
        cleaned = _build_guided_explain_fallback_text(state, hint_level)
    return {
        'title': title,
        'bloom_level': str(state.get('bloom_level') or 'understand'),
        'current_hint_level': hint_level,
        'hint_content': cleaned,
        'next_challenge_hint': next_challenge_hint,
        'evidence_refs': evidence_refs,
    }


def _coerce_general_chat_payload(raw_output: str, state: PipelineState) -> dict:
    if _is_brief_greeting(state):
        return _build_greeting_general_chat_payload(state)

    try:
        payload = _extract_json(raw_output)
        if isinstance(payload, dict):
            answer = _clean_student_display_text(payload.get('answer') or payload.get('hint_content') or raw_output.strip())
            if not answer:
                answer = '抱歉，这次没有生成成功。'
            return {
                'title': _build_general_chat_title(state, payload.get('title'), answer),
                'answer': answer,
                'follow_up': payload.get('follow_up'),
                'evidence_refs': payload.get('evidence_refs') or ['general-chat'],
            }
    except Exception:
        pass

    patterns = [
        r'"answer"\s*:\s*"([^"]+)"',
        r"'answer'\s*:\s*'([^']+)'",
    ]
    for pattern in patterns:
        m = re.search(pattern, raw_output)
        if m:
            answer = _clean_student_display_text(m.group(1).strip())
            if not answer:
                answer = '抱歉，这次没有生成成功。'
            return {
                'title': _build_general_chat_title(state, answer),
                'answer': answer,
                'follow_up': None,
                'evidence_refs': ['general-chat'],
            }

    cleaned = raw_output.strip()
    if not cleaned:
        cleaned = '抱歉，这次没有生成成功。'
    cleaned = _clean_student_display_text(cleaned)
    first_paragraph = cleaned.split('\n\n', 1)[0].strip() if cleaned else ''
    return {
        'title': _build_general_chat_title(state, first_paragraph),
        'answer': first_paragraph or '抱歉，这次没有生成成功。',
        'follow_up': None,
        'evidence_refs': ['general-chat'],
    }


def _coerce_student_raw_reply(raw_output: str, state: PipelineState) -> dict:
    if _is_brief_greeting(state):
        return _build_greeting_general_chat_payload(state)

    cleaned = _clean_student_display_text(raw_output)
    if not cleaned:
        cleaned = '抱歉，这次没有生成成功。'
    return {
        'title': _build_general_chat_title(state, cleaned),
        'answer': cleaned,
        'follow_up': None,
        'evidence_refs': ['model-raw-output'],
    }


def validate_node(state: PipelineState) -> PipelineState:
    if state.get('error_code'):
        return {
            **state,
            'validation_passed': False,
            'validation_errors': state.get('validation_errors') or [str(state.get('error_code'))],
            'result_object': None,
            'evidence_refs': [],
        }

    raw_output = state.get('raw_output', '')
    task_type = state.get('selected_task') or state.get('task_type')
    schema = RESULT_SCHEMAS.get(task_type)

    if schema is None:
        return {
            **state,
            'validation_passed': False,
            'validation_errors': [f'unsupported task_type: {task_type}'],
            'error_code': 'ERR_SCHEMA_VALIDATION',
            'result_object': None,
            'evidence_refs': [],
        }

    try:
        if task_type == 'general_chat':
            payload = _coerce_general_chat_payload(raw_output, state)
        elif task_type == 'guided_explain':
            payload = _coerce_guided_explain_payload(raw_output, state)
        else:
            payload = _extract_json(raw_output)
        if task_type == 'guided_explain':
            if not payload.get('bloom_level'):
                payload['bloom_level'] = state.get('bloom_level') or payload.get('current_hint_level') or 'understand'
            if not payload.get('current_hint_level'):
                payload['current_hint_level'] = 'hint_1'
        obj = schema.model_validate(payload)
        data = obj.model_dump()
        evidence = data.get('evidence_refs', [])
        # FLQC: evidence_refs must be non-empty for ready status
        if not evidence:
            return {
                **state,
                'validation_passed': False,
                'validation_errors': ['evidence_refs is empty'],
                'error_code': 'ERR_EMPTY_EVIDENCE',
                'result_object': data,
                'evidence_refs': [],
            }
        return {
            **state,
            'validation_passed': True,
            'validation_errors': [],
            'error_code': None,
            'result_object': data,
            'evidence_refs': evidence,
        }
    except (ValueError, ValidationError) as exc:
        if state.get('role') == 'student' and raw_output.strip():
            fallback = _coerce_student_raw_reply(raw_output, state)
            return {
                **state,
                'selected_task': 'general_chat',
                'validation_passed': True,
                'validation_errors': [],
                'error_code': None,
                'result_object': fallback,
                'evidence_refs': fallback['evidence_refs'],
            }
        return {
            **state,
            'validation_passed': False,
            'validation_errors': [str(exc)],
            'error_code': 'ERR_SCHEMA_VALIDATION',
            'result_object': None,
            'evidence_refs': [],
        }
