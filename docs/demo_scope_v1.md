# Demo Scope v1

This file defines the first demo scope.
The goal is not full completion. The goal is a directionally correct and clearly role-separated demo.

## Demo Goals

The first demo should prove:

1. The student, teacher, and admin surfaces are clearly separated
2. The system is actually centered on Bloom progression
3. The three surfaces interact through real product flows
4. The system already shows the beginnings of a training-data loop

## Demo Principles

- Do the right subset, not the full product
- Build the main stage first
- Do not over-separate backend intents in the frontend yet
- Avoid heavy second-level screens unless necessary for the demo

## Student Demo Must-Haves

- Unified new conversation entry
- System decides:
  - normal chat
  - poem project
- Poem project shows:
  - poem title
  - current Bloom level
  - recommended Bloom level
  - challenge entry
- Input supports:
  - web search
  - file upload
- Student can see teacher feedback
- Student can launch a challenge

## Teacher Demo Must-Haves

- Left navigation:
  - learning status
  - new conversation
  - my projects
  - student projects
- Default home:
  - school-wide / class learning-status view
- Teacher can inspect school-wide and class-level learning status
- Teacher can enter student poem projects and:
  - write comments
  - write review conclusions
  - correct AI answers
  - adjust Bloom levels
- Teacher queue can surface challenge-review items that require formal handling

## Admin Demo Must-Haves

- School overview dashboard
- Bloom distribution focus
- Teacher filtering
- Audit page with at least:
  - Bloom adjustments
  - answer corrections
  - review conclusions
  - challenge upgrades
  - think records
- Settings page with:
  - model-related configuration
  - web-search switch
  - file-upload switch
  - skills / MCP entry
- Data production / labeling mode with:
  - sample-type entry
  - sample list
  - sample detail
  - reward labels
  - JSONL export

## Required Demo Flows

### Flow A: Student normal conversation

- Student starts unified conversation
- System routes it to normal chat
- Conversation gets a generated title

### Flow B: Student poem-project conversation

- Student starts unified conversation
- System recognizes poem-related content
- System matches or creates poem project
- Project shows current and recommended Bloom level and stores the interaction

### Flow C: Student challenge

- Student launches challenge inside poem project
- System generates the challenge from current level, recommended level, and grade signals
- Student answers
- System updates Bloom level

### Flow D: Teacher intervention

- Teacher enters a student poem project
- Teacher corrects AI output and/or adjusts Bloom level
- Student later sees the final visible version and feedback signal

### Flow E: Admin audit and export

- Admin inspects Bloom distribution
- Admin opens one audit record or think trace
- Admin enters data-production mode
- Admin exports one JSONL training-data batch

## Explicitly Deferred

- Fully detailed guided-explanation / analysis / outline result objects
- Full classical-Chinese chain details
- Full cold-start 3-question positioning strategy
- Complex resource library
- Full export center
- Fully mature training-data governance UI
- Complex class-management flows
- Final technical spec completeness

## Frontend Design Rules

- Student surface must not feel like an admin panel
- Teacher surface must not feel like a generic chat site
- Admin surface must not feel like a shallow table template
- Avoid long explanatory copy
- Avoid course-platform shell language
- Avoid marketing/demo-course framing
