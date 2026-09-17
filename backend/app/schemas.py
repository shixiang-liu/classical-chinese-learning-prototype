from typing import Any
from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str
    password: str
    remember_me: bool = False


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = 'bearer'
    user: dict[str, Any]


class CreateStudentRequest(BaseModel):
    display_name: str
    username: str
    password: str = Field(..., min_length=6)
    teacher_id: str | None = None


class BatchCreateStudentItem(BaseModel):
    display_name: str


class BatchCreateStudentsRequest(BaseModel):
    students: list[BatchCreateStudentItem] = Field(..., min_length=1)
    teacher_id: str | None = None


class CreateTeacherRequest(BaseModel):
    display_name: str
    username: str
    password: str = Field(..., min_length=6)


class ResetPasswordRequest(BaseModel):
    new_password: str = Field(..., min_length=6)


class HistoryMessageItem(BaseModel):
    role: str = Field(..., pattern='^(user|assistant)$')
    text: str = Field(..., min_length=1)


class RunTaskRequest(BaseModel):
    raw_input: str
    task_type: str | None = None
    source_text: str | None = None
    project_id: str | None = None
    session_id: str | None = None
    history_messages: list[HistoryMessageItem] | None = None
    web_search_enabled: bool = False


class RunTaskResponse(BaseModel):
    session: dict[str, Any]
    result: dict[str, Any] | None
    state: dict[str, Any]
    project: dict[str, Any] | None = None


class LearnHouseBridgeRequest(BaseModel):
    raw_input: str = Field(..., min_length=1)
    task_type: str | None = Field(default=None, pattern='^(lesson_outline|question_analysis|guided_explain|general_chat)$')
    source_text: str | None = None
    history_messages: list[HistoryMessageItem] | None = None
    role: str = Field(default='student', pattern='^(teacher|student|admin)$')
    user_id: str | None = None
    web_search_enabled: bool = False


class LearnHouseBridgeResponse(BaseModel):
    ok: bool = True
    text: str
    result_type: str
    content: dict[str, Any]
    state: dict[str, Any]


class FileExtractResponse(BaseModel):
    file_name: str
    content_type: str
    text: str


class ExportResponse(BaseModel):
    format: str = Field(..., pattern='^(docx|json)$')
    file_path: str
    fallback_message: str | None = None


class ReviewResultRequest(BaseModel):
    review_status: str = Field(..., pattern='^(accepted|edited|rejected)$')
    content: dict[str, Any] | None = None


class TeacherFeedbackRequest(BaseModel):
    student_id: str
    content: str = Field(..., min_length=1)
    poem_title: str | None = None
    is_ai_assisted: bool = False


class BloomOverrideRequest(BaseModel):
    student_id: str
    bloom_level: str = Field(..., pattern='^(remember|understand|apply|analyze|evaluate|create)$')
    note: str | None = None


class ChallengePreviewRequest(BaseModel):
    poem_title: str = Field(..., min_length=1)
    session_id: str | None = None


class ChallengePreviewResponse(BaseModel):
    poem_title: str
    from_level: str
    to_level: str
    difficulty: str
    review_needed: bool
    question_json: dict[str, Any]
    rubric_json: list[str]


class ChallengeSubmitRequest(BaseModel):
    poem_title: str
    session_id: str | None = None
    from_level: str = Field(..., pattern='^(remember|understand|apply|analyze|evaluate)$')
    student_answer: str = Field(..., min_length=1)


class ProjectCreateRequest(BaseModel):
    title: str = Field(..., min_length=1)
    content_type: str = Field(..., pattern='^(general|poem|classical_prose|question_set)$')
    status: str = Field(default='draft', pattern='^(draft|active|archived)$')


class ProjectUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1)
    content_type: str | None = Field(default=None, pattern='^(general|poem|classical_prose|question_set)$')
    status: str | None = Field(default=None, pattern='^(draft|active|archived)$')


class ProjectResolveRequest(BaseModel):
    session_id: str = Field(..., min_length=1)
    title: str = Field(..., min_length=1)
    content_type: str = Field(..., pattern='^(poem|classical_prose)$')


class AdminConfigRequest(BaseModel):
    config_key: str = Field(..., min_length=1)
    config_json: dict[str, Any]


class TemplateVersionCreateRequest(BaseModel):
    task_type: str = Field(..., pattern='^(lesson_outline|question_analysis|guided_explain|general_chat)$')
    template_text: str = Field(..., min_length=1)
    activate: bool = True


class TemplateRollbackRequest(BaseModel):
    version_id: str = Field(..., min_length=1)


class HintStepRequest(BaseModel):
    poem_title: str = Field(..., min_length=1)
    current_hint_level: str = Field(..., pattern='^(hint_1|hint_2|hint_3|answer)$')
    raw_input: str = Field(..., min_length=1)
    source_text: str | None = None
    project_id: str | None = None
    web_search_enabled: bool = False
    task_type: str | None = 'guided_explain'
    question_text: str | None = None
    hint_ladder: dict[str, str] | None = None
    answer_text: str | None = None


class HintStepResponse(BaseModel):
    current_hint_level: str
    next_hint_level: str | None = None
    hint_content: str
    revealed_answer: str | None = None
    question_text: str | None = None
    poem_title: str | None = None
    evidence_refs: list[str] = []
    source: str = 'generated'
    session: dict[str, Any] | None = None
    result: dict[str, Any] | None = None
    state: dict[str, Any] | None = None
    used_existing_ladder: bool = False
    bloom_level: str | None = None
    next_challenge_hint: str | None = None
    title: str | None = None
    hint_ladder: dict[str, str] | None = None
    answer_available: bool = False
    answer_text: str | None = None
    has_more_hint: bool = False
    message: str | None = None
    error_code: str | None = None
    project_id: str | None = None
    selected_task: str | None = None
    context_mode: str | None = None
    review_status: str | None = None
    status: str | None = None
    mastery_status: str | None = None
    prompt_preview: str | None = None
    created_at: str | None = None
    metadata: dict[str, Any] | None = None
    challenge_preview: dict[str, Any] | None = None
    trajectory_summary: dict[str, Any] | None = None
    diagnostics: dict[str, Any] | None = None
    actions: list[str] | None = None
    warnings: list[str] | None = None
    errors: list[str] | None = None
    project: dict[str, Any] | None = None
    projects: list[dict[str, Any]] | None = None
    project_results: list[dict[str, Any]] | None = None
    project_sessions: list[dict[str, Any]] | None = None
    student_trajectory: list[dict[str, Any]] | None = None
    current_template_version: dict[str, Any] | None = None
    template_versions: list[dict[str, Any]] | None = None
    admin_configs: list[dict[str, Any]] | None = None
    config_json: dict[str, Any] | None = None
    config_key: str | None = None
    rollback_version_id: str | None = None
    template_version_id: str | None = None
    template_task_type: str | None = None
    template_text: str | None = None
    session_id: str | None = None
    result_id: str | None = None
    task_type: str | None = None
    raw_input: str | None = None
    source_text: str | None = None
    content_type: str | None = None
    allowed_tasks: list[str] | None = None
    pruning_reasons: list[str] | None = None
    bloom_level_target: str | None = None
    validation_errors: list[str] | None = None
    validation_passed: bool | None = None
    is_structured: bool | None = None
    generation_allowed: bool | None = None
    retrieval_needed: bool | None = None
    retrieved_chunks: list[str] | None = None
    sedimentation_summary: dict[str, Any] | None = None
    result_object: dict[str, Any] | None = None
    raw_output: str | None = None
    user_id: str | None = None
    role: str | None = None
    age_stage: str | None = None
    display_name: str | None = None
    latest_bloom: dict[str, Any] | None = None
    latest_result_type: str | None = None
    latest_result_title: str | None = None
    latest_session_status: str | None = None
    latest_result_status: str | None = None
    latest_review_status: str | None = None
    latest_prompt_preview: str | None = None
    latest_created_at: str | None = None
    history: list[dict[str, Any]] | None = None
    session_history: list[dict[str, Any]] | None = None
    result_history: list[dict[str, Any]] | None = None
    trace_events: list[dict[str, Any]] | None = None
    teacher_feedback: list[dict[str, Any]] | None = None
    challenge_ready: bool | None = None
    challenge_target_level: str | None = None
    challenge_review_needed: bool | None = None
    challenge_difficulty: str | None = None
    challenge_prompt: str | None = None
    challenge_requirements: list[str] | None = None
    challenge_rubric: list[str] | None = None
    current_level_label: str | None = None
    next_level_label: str | None = None
    can_continue_hint: bool | None = None
    can_reveal_answer: bool | None = None
    can_start_challenge: bool | None = None
    review_needed: bool | None = None
    completed: bool | None = None
    exported: bool | None = None
    export_path: str | None = None
    links: dict[str, str] | None = None
    ui_hints: dict[str, Any] | None = None
    debug: dict[str, Any] | None = None
    admin_notes: list[str] | None = None
    note: str | None = None
    summary: str | None = None
    mode: str | None = None
    route: str | None = None
    trace_id: str | None = None
    updated_at: str | None = None
    web_search_used: bool | None = None
    action: str | None = None
    milestone: str | None = None
    progression_label: str | None = None
    reveal_mode: str | None = None
    challenge_preview_text: str | None = None
    answer_revealed: bool | None = None
    used_template_version_id: str | None = None
    current_hint_label: str | None = None
    next_hint_label: str | None = None
    trajectory_items: list[dict[str, Any]] | None = None
    project_count: int | None = None
    result_count: int | None = None
    session_count: int | None = None
    config_count: int | None = None
    template_count: int | None = None
    can_rollback: bool | None = None
    active_template: dict[str, Any] | None = None
    active_config: dict[str, Any] | None = None
    latest_challenge: dict[str, Any] | None = None
    latest_session: dict[str, Any] | None = None
    latest_result: dict[str, Any] | None = None
    latest_feedback: dict[str, Any] | None = None
    latest_override: dict[str, Any] | None = None
    latest_trace: dict[str, Any] | None = None
    latest_project: dict[str, Any] | None = None
    latest_template_version: dict[str, Any] | None = None
    latest_admin_config: dict[str, Any] | None = None
    extra: dict[str, Any] | None = None

    model_config = {'extra': 'allow'}


class StudentTrajectoryResponse(BaseModel):
    summary: dict[str, Any]
    timeline: list[dict[str, Any]]


class AdminSkillsSnapshotResponse(BaseModel):
    current_template_version: dict[str, Any] | None = None
    template_versions: list[dict[str, Any]]
    admin_configs: list[dict[str, Any]]
    skills: dict[str, Any]
    mcp: dict[str, Any]
    available_tasks: list[str]
    active_versions_by_task: dict[str, dict[str, Any]]


class ProjectDetailResponse(BaseModel):
    project: dict[str, Any]
    sessions: list[dict[str, Any]]
    results: list[dict[str, Any]]
    metrics: dict[str, Any]


class ProjectListResponse(BaseModel):
    projects: list[dict[str, Any]]
    total: int
    owner_role: str | None = None
    owner_id: str | None = None


class SimpleMessageResponse(BaseModel):
    message: str
    ok: bool = True
    data: dict[str, Any] | None = None

    model_config = {'extra': 'allow'}


class TemplateVersionActionResponse(BaseModel):
    version: dict[str, Any]
    versions: list[dict[str, Any]]
    ok: bool = True
    message: str | None = None


class AdminConfigResponse(BaseModel):
    config: dict[str, Any]
    configs: list[dict[str, Any]]
    ok: bool = True
    message: str | None = None


class ProjectMutationResponse(BaseModel):
    project: dict[str, Any]
    ok: bool = True
    message: str | None = None

    model_config = {'extra': 'allow'}


class ProjectListItem(BaseModel):
    project_id: str
    title: str
    content_type: str
    owner_id: str
    owner_role: str
    status: str
    created_at: str

    model_config = {'extra': 'allow'}


class AdminConfigItem(BaseModel):
    config_key: str
    config_json: dict[str, Any]
    updated_by: str
    updated_at: str


class TemplateVersionItem(BaseModel):
    version_id: str
    task_type: str
    template_text: str
    created_by: str
    created_at: str
    is_active: int | bool


class StudentTrajectoryItem(BaseModel):
    kind: str
    created_at: str
    title: str
    summary: str
    payload: dict[str, Any] | None = None

    model_config = {'extra': 'allow'}


class StudentTrajectorySummary(BaseModel):
    current_bloom: dict[str, Any] | None = None
    latest_challenge: dict[str, Any] | None = None
    session_count: int
    challenge_count: int
    feedback_count: int
    override_count: int
    result_count: int
    latest_session: dict[str, Any] | None = None
    latest_result: dict[str, Any] | None = None
    latest_feedback: dict[str, Any] | None = None
    latest_override: dict[str, Any] | None = None

    model_config = {'extra': 'allow'}


class AdminSkillsActionResponse(BaseModel):
    snapshot: AdminSkillsSnapshotResponse
    ok: bool = True
    message: str | None = None


class ProjectSummaryMetrics(BaseModel):
    session_count: int
    result_count: int
    ready_result_count: int
    pending_review_count: int
    latest_session_at: str | None = None
    latest_result_at: str | None = None

    model_config = {'extra': 'allow'}


class HintLadderStep(BaseModel):
    level: str
    label: str
    content: str
    is_locked: bool = False
    is_current: bool = False

    model_config = {'extra': 'allow'}


class HintLadderResponse(BaseModel):
    current_hint_level: str
    next_hint_level: str | None = None
    steps: list[HintLadderStep]
    answer_text: str | None = None
    question_text: str | None = None
    title: str | None = None
    bloom_level: str | None = None
    evidence_refs: list[str] = []
    source: str = 'generated'
    session: dict[str, Any] | None = None
    result: dict[str, Any] | None = None

    model_config = {'extra': 'allow'}


class ProjectTaskRunRequest(BaseModel):
    raw_input: str
    task_type: str | None = None
    source_text: str | None = None
    web_search_enabled: bool = False


class ProjectTaskRunResponse(BaseModel):
    project: dict[str, Any]
    session: dict[str, Any]
    result: dict[str, Any] | None = None
    state: dict[str, Any]

    model_config = {'extra': 'allow'}


class ProjectOwnershipResponse(BaseModel):
    project: dict[str, Any]
    owner: dict[str, Any] | None = None

    model_config = {'extra': 'allow'}


class AdminSkillsPreviewResponse(BaseModel):
    snapshot: AdminSkillsSnapshotResponse
    preview_text: str | None = None

    model_config = {'extra': 'allow'}


class ProjectTimelineItem(BaseModel):
    kind: str
    created_at: str
    session_id: str | None = None
    result_id: str | None = None
    title: str
    summary: str

    model_config = {'extra': 'allow'}


class ProjectTimelineResponse(BaseModel):
    project: dict[str, Any]
    timeline: list[ProjectTimelineItem]
    metrics: dict[str, Any]

    model_config = {'extra': 'allow'}


class AdminTraceExportResponse(BaseModel):
    traces: list[dict[str, Any]]
    exported_at: str

    model_config = {'extra': 'allow'}


class SkillConfigResponse(BaseModel):
    skill_key: str
    config: dict[str, Any]
    updated_at: str | None = None

    model_config = {'extra': 'allow'}


class McpConfigResponse(BaseModel):
    providers: list[str]
    enabled: bool
    hot_reload: bool

    model_config = {'extra': 'allow'}


class ProjectResultsResponse(BaseModel):
    project: dict[str, Any]
    results: list[dict[str, Any]]

    model_config = {'extra': 'allow'}


class ProjectSessionsResponse(BaseModel):
    project: dict[str, Any]
    sessions: list[dict[str, Any]]

    model_config = {'extra': 'allow'}


class StudentLearningSnapshotResponse(BaseModel):
    bloom: dict[str, Any] | None = None
    challenges: list[dict[str, Any]]
    sessions: list[dict[str, Any]]
    timeline: list[dict[str, Any]]

    model_config = {'extra': 'allow'}


class TemplateCatalogResponse(BaseModel):
    versions: list[dict[str, Any]]
    active_versions_by_task: dict[str, dict[str, Any]]

    model_config = {'extra': 'allow'}


class AdminConfigCatalogResponse(BaseModel):
    configs: list[dict[str, Any]]

    model_config = {'extra': 'allow'}


class ProjectCatalogResponse(BaseModel):
    projects: list[dict[str, Any]]

    model_config = {'extra': 'allow'}


class GenericOkResponse(BaseModel):
    ok: bool = True
    message: str | None = None

    model_config = {'extra': 'allow'}


class TeacherProjectContextResponse(BaseModel):
    projects: list[dict[str, Any]]
    suggested_project_id: str | None = None

    model_config = {'extra': 'allow'}


class StudentHintActionResponse(BaseModel):
    hint: HintLadderResponse
    ok: bool = True
    message: str | None = None

    model_config = {'extra': 'allow'}


class AdminSkillsRollbackResponse(BaseModel):
    version: dict[str, Any]
    snapshot: AdminSkillsSnapshotResponse
    ok: bool = True

    model_config = {'extra': 'allow'}


class ProjectActionSummaryResponse(BaseModel):
    project: dict[str, Any]
    metrics: dict[str, Any]
    ok: bool = True

    model_config = {'extra': 'allow'}


class StudentTrajectoryInsightResponse(BaseModel):
    summary: StudentTrajectorySummary
    timeline: list[StudentTrajectoryItem]
    ok: bool = True

    model_config = {'extra': 'allow'}


class AdminRuntimeSnapshotResponse(BaseModel):
    traces: list[dict[str, Any]]
    results: list[dict[str, Any]]
    skills: dict[str, Any]
    mcp: dict[str, Any]

    model_config = {'extra': 'allow'}


class ProjectRuntimeOverviewResponse(BaseModel):
    project: dict[str, Any]
    metrics: ProjectSummaryMetrics
    timeline: list[ProjectTimelineItem]

    model_config = {'extra': 'allow'}


class HintStepActionResponse(BaseModel):
    hint: HintStepResponse
    ok: bool = True
    message: str | None = None

    model_config = {'extra': 'allow'}


class ProjectDigestResponse(BaseModel):
    project: dict[str, Any]
    latest_session: dict[str, Any] | None = None
    latest_result: dict[str, Any] | None = None
    metrics: dict[str, Any]

    model_config = {'extra': 'allow'}


class AdminTemplatePreviewResponse(BaseModel):
    task_type: str
    template_text: str
    active_version: dict[str, Any] | None = None

    model_config = {'extra': 'allow'}


class AdminGovernanceSnapshotResponse(BaseModel):
    traces: list[dict[str, Any]]
    configs: list[dict[str, Any]]
    templates: list[dict[str, Any]]

    model_config = {'extra': 'allow'}
