import logging
import re

from app.graph.state import PipelineState

logger = logging.getLogger(__name__)

ERR_UNRECOGNIZED_CONTENT = 'ERR_UNRECOGNIZED_CONTENT'

_CONTENT_KEYWORDS = {
    'poem': ['诗', '词', '古诗', '律诗', '绝句', '词牌', '静夜思', '春晓', '登鹳雀楼', '望庐山瀑布', '悯农', '咏鹅'],
    'classical_prose': ['文言文', '古文', '论语', '孟子', '左传', '史记', '桃花源记', '岳阳楼记', '出师表'],
    'question_set': ['题目', '选择题', '填空题', '解析', '试题', '考题', '做题', '问答题'],
}

_TASK_KEYWORDS = {
    'lesson_outline': ['备课', '教案', '教学设计', '课堂设计', '教学提纲', '教学目标'],
    'question_analysis': ['解析', '分析题目', '解题', '题目分析', '做这道题', '分析这道'],
    'guided_explain': ['讲解', '解释', '意思', '翻译', '什么意境', '怎么理解', '背景', '表达了'],
}

_DEFAULT_AGE_STAGE = 'primary'
_TITLE_RE = re.compile(r'《([^》]{1,32})》')
_LOW_CONFIDENCE_SUFFIX_RE = re.compile(r'(讲解|题目解析|教学提纲|备课提纲|学习项目)$')
_ANCHOR_HINTS = {
    'poem': ['静夜思', '春晓', '登鹳雀楼', '望庐山瀑布', '悯农', '咏鹅'],
    'classical_prose': ['桃花源记', '岳阳楼记', '出师表', '论语', '孟子', '左传', '史记'],
}

_FACT_QUESTION_PATTERNS = (
    r'作者是谁',
    r'谁写的',
    r'哪位诗人',
    r'哪个朝代',
    r'什么朝代',
    r'写于什么时期',
    r'题目是什么意思',
    r'这首诗写了什么',
)


def _looks_like_poem(text: str) -> bool:
    stripped = [line.strip() for line in text.splitlines() if line.strip()]
    if not stripped:
        return False
    if '《' in text and '》' in text:
        return True
    if len(stripped) >= 2 and sum('，' in line or '。' in line for line in stripped[:4]) >= 2:
        return True
    return False


def _looks_like_question_set(text: str) -> bool:
    exam_tokens = ['题目', '选择题', '填空题', '试题', '选项', '答案', 'A.', 'B.', 'C.', 'D.']
    if any(token in text for token in exam_tokens):
        return True
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if len(lines) >= 2 and sum('？' in line or '?' in line for line in lines[:4]) >= 2:
        return True
    return False


def _looks_like_classical_prose(text: str) -> bool:
    return any(token in text for token in ['者', '也', '乎', '焉']) and len(text) > 24


def _detect_content_type(text: str) -> str:
    for ctype, keywords in _CONTENT_KEYWORDS.items():
        if any(keyword in text for keyword in keywords):
            return ctype

    if _looks_like_poem(text):
        return 'poem'
    if _looks_like_question_set(text):
        return 'question_set'
    if _looks_like_classical_prose(text):
        return 'classical_prose'

    return 'unknown'


def _detect_task_type(text: str, role: str) -> str:
    for task, keywords in _TASK_KEYWORDS.items():
        if any(keyword in text for keyword in keywords):
            if task == 'lesson_outline' and role not in ('teacher', 'admin'):
                continue
            return task

    if role in ('teacher', 'admin'):
        return 'question_analysis'
    return 'guided_explain'


def _is_simple_fact_question(text: str, source_text: str) -> bool:
    question = text.strip()
    if not question or source_text.strip():
        return False
    if len(question) > 40:
        return False
    return any(re.search(pattern, question) for pattern in _FACT_QUESTION_PATTERNS)


def _detect_age_stage(text: str) -> str:
    if any(word in text for word in ['初中', '中学', '七年级', '八年级', '九年级']):
        return 'junior'
    if any(word in text for word in ['高中', '高一', '高二', '高三']):
        return 'senior'
    return _DEFAULT_AGE_STAGE


def _extract_content_anchor(text: str, content_type: str) -> dict | None:
    if content_type not in {'poem', 'classical_prose'}:
        return {
            'content_type': content_type,
            'title': None,
            'confidence': 'none',
        }

    match = _TITLE_RE.search(text)
    if match:
        return {
            'content_type': content_type,
            'title': match.group(1).strip(),
            'confidence': 'high',
        }

    for hint in _ANCHOR_HINTS.get(content_type, []):
        if hint in text:
            return {
                'content_type': content_type,
                'title': hint,
                'confidence': 'high',
            }

    stripped = text.strip()
    if not stripped:
        return {
            'content_type': content_type,
            'title': None,
            'confidence': 'none',
        }

    first_line = next((line.strip() for line in stripped.splitlines() if line.strip()), '')
    normalized = _LOW_CONFIDENCE_SUFFIX_RE.sub('', first_line).strip("《》\"' \t")
    if 1 <= len(normalized) <= 24:
        return {
            'content_type': content_type,
            'title': normalized,
            'confidence': 'low',
        }

    return {
        'content_type': content_type,
        'title': None,
        'confidence': 'none',
    }


def grounding_node(state: PipelineState) -> PipelineState:
    source_text = state.get('source_text') or ''
    raw_input = str(state.get('raw_input') or '').strip()
    text = f"{raw_input}\n{source_text}".strip()
    role = state['role']

    content_type = _detect_content_type(text)
    explicit_task_type = state.get('task_type')
    if text and content_type == 'unknown':
        content_type = 'general'

    if explicit_task_type:
        task_type = explicit_task_type
    elif role == 'student':
        task_type = 'general_chat'
    elif content_type == 'general':
        task_type = 'general_chat'
    else:
        task_type = _detect_task_type(text, role)
    age_stage = _detect_age_stage(text)
    content_anchor = _extract_content_anchor(text, content_type)

    return {
        **state,
        'content_type': content_type,
        'task_type': task_type,
        'age_stage': age_stage,
        'content_anchor': content_anchor,
        'context_mode': 'full',
        'error_code': None,
    }
