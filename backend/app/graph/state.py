from typing import TypedDict, Literal


class PipelineState(TypedDict):
    # input
    raw_input: str
    role: Literal['student', 'teacher', 'admin']
    user_id: str
    project_id: str | None
    history_messages: list[dict[str, str]]

    # Fground
    content_type: str   # poem / classical_prose / question_set / unknown
    task_type: str      # lesson_outline / question_analysis / guided_explain / general_chat
    age_stage: str      # primary / junior / senior
    content_anchor: dict | None

    # routing
    is_structured: bool
    allowed_tasks: list[str]
    selected_task: str

    # pruning
    pruning_passed: bool
    pruning_reasons: list[str]
    retrieval_needed: bool
    generation_allowed: bool

    # RAG
    context_mode: Literal['lite', 'full']
    web_search_requested: bool
    web_search_enabled: bool
    mcp_runtime: dict[str, object] | None
    retrieved_chunks: list[str]
    source_text: str | None

    # generation
    raw_output: str

    # FLQC
    validation_passed: bool
    validation_errors: list[str]
    error_code: str | None
    result_object: dict | None
    evidence_refs: list[str]
    sedimentation_summary: dict | None

    # bloom
    bloom_level: str
    bloom_level_target: str
    mastery_status: Literal['inferred', 'teacher_confirmed', 'teacher_overridden']
