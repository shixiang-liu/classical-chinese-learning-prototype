from pydantic import BaseModel, Field
from typing import Any


class ActivityStep(BaseModel):
    step: int
    name: str
    duration: str
    description: str


class HintLadder(BaseModel):
    hint_1: str
    hint_2: str
    hint_3: str
    answer: str


class LessonOutline(BaseModel):
    title: str
    teaching_goals: list[str] = Field(..., min_length=1)
    key_points: list[str] = Field(..., min_length=1)
    difficult_points: list[str] = Field(..., min_length=1)
    activity_flow: list[ActivityStep] = Field(..., min_length=1)
    evidence_refs: list[str] = Field(..., min_length=1)


class QuestionAnalysis(BaseModel):
    title: str
    question_text: str
    analysis_steps: list[str] = Field(..., min_length=1)
    hint_ladder: HintLadder
    evidence_refs: list[str] = Field(..., min_length=1)


class GuidedExplain(BaseModel):
    title: str
    bloom_level: str
    current_hint_level: str  # hint_1 / hint_2 / hint_3 / answer
    hint_content: str
    next_challenge_hint: str | None = None
    evidence_refs: list[str] = Field(..., min_length=1)


class GeneralChat(BaseModel):
    title: str
    answer: str
    follow_up: str | None = None
    evidence_refs: list[str] = Field(..., min_length=1)


RESULT_SCHEMAS: dict[str, type] = {
    'lesson_outline': LessonOutline,
    'question_analysis': QuestionAnalysis,
    'guided_explain': GuidedExplain,
    'general_chat': GeneralChat,
}
