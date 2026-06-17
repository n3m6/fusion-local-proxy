# Research Notes — Part 2

A second batch of external research relevant to **fusion-local-proxy**'s ensemble
pipeline (panel → judge → synthesizer). As in [`RESEARCH.md`](./RESEARCH.md),
for each paper we cover the techniques it introduces, which of those are usable
in this project, and why they are relevant to our specific architecture. The
papers are numbered 5–8 to continue from that file (Papers 1–4 live there).

Quick orientation on how this project maps to the multi-agent literature:

- Our **panel** = a set of independent base models run in parallel
  (`PanelRunner`), optionally steered with cognitive `thinkingMode`s
  (`lateral` / `vertical` / `systems` / `divergent`).
- Our **judge** = an LLM-as-a-Judge that emits a structured `Analysis`
  (`JudgeStep`, `analysis-schema.ts`, `judge-prompt.ts`).
- Our **synthesizer** = a meta-model / integrator that is the "final authority,
  not just a blender" (`SynthesizeStep`, `synthesis-prompt.ts`), with a
  `selfJudge` fallback when no judge is configured.

Where the first batch established that **answer-level agreement is a weak signal
of correctness**, this batch sharpens _what to do about it_: the dominant lever
is **base-model reasoning strength + diversity** (Papers 5, 8), naive debate is
**bounded by the strongest reasoner and can even hurt strong models** (Papers 5,
7), and **shared misconceptions are not fixed by adding more similar models**
(Paper 6) — but **consistency/diversity can be turned into a cheap confidence
and routing signal** (Paper 8).

---

## Paper 5 — Can LLM Agents Really Debate? A Controlled Study of Multi-Agent Debate in Logical Reasoning

- **Link:** https://arxiv.org/abs/2511.07784
- **Authors / venue:** Haolun Wu (McGill / Mila), Zhenkun Li, Lingyao Li
  (University of South Florida) — arXiv 2025, cs.MA

> A rigorous, controlled dissection of _what actually makes debate work_, on a
> task with verifiable ground truth. The headline is sobering for any
> debate-style design: structure barely matters; **model strength and diversity
> dominate.**

### Techniques used

1. **A controlled MAD testbed: Knight–Knave–Spy logic puzzles.** Chosen because
   they need real deductive reasoning, decompose **step-by-step** (one player's
   role at a time), and have **unambiguous ground truth**. Dataset of 1,800
   puzzles, sizes 4–9 players (300 each), so difficulty scales cleanly.
2. **A phased debate protocol.** (i) _Initial proposal_: each agent independently
   assigns roles + a self-reported confidence. (ii) _Player-by-player debate
   loop_: a debate phase (agents argue about one player, citing peers) followed
   by a self-adjustment phase (each agent may revise). (iii) _Final decision_:
   per-player majority vote, with a supervisor model (gpt-5) breaking ties.
3. **Six controlled factors (C1–C6), one varied at a time vs. an anchor:** team
   size, team composition (homogeneous vs. heterogeneous), confidence
   visibility, debate order, debate depth, and task difficulty. Models were first
   mapped onto an accuracy×confidence grid to build balanced/stressed/diverse
   teams.
4. **Process-level analysis, not just accuracy.** Three desiderata of _effective_
   debate — **inclusive deliberation**, **rationale over assertion**, and
   **advancement of understanding** — operationalized via belief-state-transition
   tracking and an external judge (deepseek-r1) rating the soundness (1–4) of
   each agent's agree/disagree reasoning.

### Key findings

- **Reasoning strength + diversity dominate; structure barely moves the needle.**
  Debate accuracy is _bounded by the strongest reasoner_; heterogeneity adds
  modest, consistent gains **only when strong reasoners are present**. Order,
  confidence visibility, and debate depth were statistically insignificant. A
  regression found _initial accuracy_ (β ≈ 0.60) and _number of agents_ the
  strongest positive predictors; _task difficulty_ negative; **moderate "initial
  chaos" (early disagreement) positive**.
- **Debate's value is overturning a wrong consensus.** `MaW→C` transitions
  (majority-wrong → correct) are rare but carry the largest positive weight on
  final accuracy. Conversely, **majority pressure suppresses independent
  correction**: under a wrong majority, weak models corrected only ~3.6% of the
  time vs. ~30–34% for strong models.
- **Rationality predicts correction.** Agents that change position in response to
  _valid_ arguments correct >90% of the time; "irrational" conformity-driven
  changes correct <55%. Weak models can't reliably judge argument quality, so
  they defer to consensus — fueling echo chambers.

### What can be used in this project

- **Spend on model quality before mechanism.** Their cleanest practical message:
  a clever orchestration won't rescue weak base models. For us this argues for
  pointing scarce budget at a **strong synthesizer (and judge)** rather than
  elaborate multi-round panel choreography. It directly supports the README's
  "use your strongest model as synthesizer" guidance.
- **"Moderate initial chaos helps" → treat panel disagreement as fuel, not
  noise.** This reinforces a theme from `RESEARCH.md` (Papers 1 & 3): a panel
  that _disagrees_ is where the judge/synthesizer earns its keep. We could
  surface a panel-spread statistic and escalate effort when disagreement is
  moderate (productive) — while noting that _excessive_ early chaos hurt
  consensus stability in their data, so disagreement isn't monotonically good.
- **The synthesizer must be strong enough to overturn a wrong panel majority.**
  Their `MaW→C` result is the empirical core of our "synthesizer is an authority,
  not a vote-counter" stance. A `selfJudge` synthesizer that merely tallies panel
  agreement would reproduce _majority pressure_; our prompts should keep pushing
  it to independently overturn confident-but-wrong consensus.
- **Skip low-value structural knobs.** If we ever add a panel-debate round, don't
  bother engineering debate order or confidence-sharing — they showed negligible
  effect. Invest in diversity and reasoning strength instead.

### What is relevant for us

- It is a **controlled, ground-truth study** of the exact failure mode our design
  fears: confident convergence on a wrong answer, with weak agents conforming. It
  validates **panel diversity** _and_ the requirement that diversity include at
  least one strong reasoner.
- The "**bounded by the strongest reasoner**" ceiling is a useful expectation
  setter: fusion can't exceed what its best participant can reach on a hard task;
  its value is reliability, error-correction, and integration — not magic.
- **Scope caveat:** their task is stepwise logic with verifiable answers, the
  opposite end of the spectrum from our open-ended chat/coding traffic. Treat the
  _direction_ (strength + diversity > structure) as transferable; the exact
  significance of each knob may differ on generative tasks.

---

## Paper 6 — Multi-LLM Debate: Framework, Principals, and Interventions

- **Link:** https://proceedings.neurips.cc/paper_files/paper/2024/hash/32e07a110c6c6acf1afbf2bf82b614ad-Abstract-Conference.html
- **Authors / venue:** Andrew Estornell, Yang Liu — NeurIPS 2024

> The theoretical companion to Paper 5: _why_ homogeneous debate stagnates, and
> three concrete interventions to fix it. Its echo-chamber / shared-misconception
> theorems are the formal backbone for our panel-diversity and judge-independence
> rules.

### Techniques used

1. **Debate as in-context learning over latent concepts.** Building on Xie et
   al. (2021), they model debate as Bayesian inference: each task has latent
   "concepts," and peers' responses act like in-context examples that shift every
   agent's posterior. This makes debate dynamics analyzable in closed form.
2. **Two negative principles, proven.**
   - **Information diversity is necessary.** With `n` identical-configuration
     agents, the probability that a debate round changes the dominant perceived
     concept → 0 as `n` grows: **static debate dynamics / echo chamber**. More
     copies of the same model defeats the purpose of debate.
   - **Shared misconceptions are self-reinforcing.** If ≥ half the agents share an
     erroneous concept `θ'` (e.g., from correlated training data), debate
     converges to the _wrong_ answer — and **adding more models does not help**,
     because correlated training makes them likely to share the same error.
3. **Three interventions (best applied in this order).**
   - **Quality-pruning** — keep the `k` responses most _relevant_ to the task
     (raises convergence to correct answers).
   - **Diversity-pruning** — among those, drop near-duplicate responses to
     _maximize information entropy_ (provably lowers the chance of converging to a
     shared-misconception answer). KL terms are approximated with **sentence
     embeddings**.
   - **Misconception-refutation** — explicitly list the misconceptions/errors in
     responses, then re-prompt for a _refutation + corrected_ response. Motivated
     by the result that **LLMs are better at evaluating answers than producing
     them**.
   - Combined (quality → diversity → refutation) beats any single intervention;
     applied individually they can _underperform a single model_.
4. **Validation.** Consistent gains across BoolQ, MMLU, MathQ, TruthfulQA and
   three model families (GPT, Llama, Mistral).

### What can be used in this project

- **A pre-synthesis "prune" stage over panel results.** Quality- and
  diversity-pruning map almost directly onto a lightweight, embedding-based
  filter we could run on `PanelResult[]` before `SynthesizeStep`:
  - _Quality-pruning_ ≈ drop panelist outputs that are off-topic / low-relevance
    to the user request.
  - _Diversity-pruning_ ≈ down-weight near-duplicate answers so the synthesizer
    doesn't mistake `k` copies of one view for `k` independent confirmations
    (a concrete defense against the "consistency illusion" from `RESEARCH.md`
    Paper 2). This is cheap — sentence embeddings, no extra LLM calls.
- **Misconception-refutation ≈ what our judge already does — formalize it.** Our
  `judge-prompt.ts` asks for `issues` (with `trigger`/`evidence`) and
  `corrections`; this paper gives that the theoretical justification ("evaluate,
  then correct" beats "generate") and suggests an explicit
  _identify → refute → corrected-response_ loop the judge or synthesizer could
  follow per discrepancy.
- **"Adding more similar models won't fix a shared error."** A direct, citable
  argument for **cross-family panel diversity** and for keeping the **judge in a
  different family than the panel** — strengthening the README guidance and
  complementing `RESEARCH.md` Paper 3's self-preference finding.

### What is relevant for us

- It supplies the **formal theory** behind beliefs our prompts already encode:
  "candidates trained on similar data share blind spots" is exactly their
  shared-misconception theorem. Echo-chamber and "tyranny of the majority" are
  named, proven failure modes — good ammunition for our independence-first design.
- The **evaluate-beats-generate** result is the principled basis for having a
  dedicated judge/synthesizer _critique_ candidates rather than just blending
  them — i.e., why our synthesizer is an authority, not an averager.
- **Cost caveat (theirs, and ours):** misconception-refutation re-prompts each
  debater multiple times, and the embedding-proxy interventions are weaker where
  embeddings are uninformative (e.g., arithmetic). If we adopt pruning, do it as
  a _cheap embedding filter_ first; reserve any refutation re-prompting for the
  judge stage where we already pay for an evaluation pass.

---

## Paper 7 — Beyond Single Models: Enhancing LLM Detection of Ambiguity in Requests Through Debate

- **Link:** https://ieeexplore.ieee.org/abstract/document/11236658
  (preprint: https://arxiv.org/abs/2507.12370)
- **Authors / venue:** Ana Davila, Jacinto Colan, Yasuhisa Hasegawa — 2025 SICE
  Festival with Annual Conference (SICE FES)

> The most deployment-relevant paper here: it studies **small local models
> (7–9B)** — exactly the Ollama/LM Studio class fusion-local-proxy targets — and
> finds debate's benefit is strongly **model-dependent**.

### Techniques used

1. **Task: ambiguity detection/resolution in user requests.** A programmatically
   generated dataset of diverse ambiguities — a different and practically useful
   objective: _recognizing when a request is underspecified_ rather than
   answering it outright.
2. **Leader–follower debate with role rotation.** One **Leader** proposes an
   interpretation; **two Followers** must challenge it. The two-follower design
   forces the leader to convince _two independent_ agents, raising the bar for
   consensus and reducing premature agreement on a flawed reading. Roles **rotate**
   so each of the three models leads in turn (removing fixed-leader bias). Up to
   ~5 rounds.
3. **Three small open models:** Llama3-8B, Gemma2-9B, Mistral-7B.

### Key findings

- **Debate's value is highly model-dependent.** It lifted the weaker models a lot
  — Mistral-7B **28.3% → 76.7%**, Llama3-8B **13.3% → 40.0%** — but **hurt the
  already-strong model**: Gemma2-9B fell from **80.0% solo to 48.3% in debate**.
- **Takeaway:** structured debate is a _targeted augmentation for weaker models_,
  not a universal win; forcing a strong model into a committee can drag it toward
  a worse, compromise answer.

### What can be used in this project

- **An ambiguity-detection step is a genuinely missing capability.** Today the
  pipeline always tries to _answer_. We could add an explicit instruction (to the
  panel, judge, or synthesizer) to **flag underspecified/ambiguous requests and
  ask a clarifying question instead of guessing** — and the judge's `Analysis`
  could carry an `ambiguity`/`clarificationNeeded` field. This is a prompt-level
  change that fits our no-architecture-change comfort zone.
- **Don't make a strong model debate down to the committee.** Their Gemma2 result
  is a concrete warning that mirrors `RESEARCH.md` Paper 4 ("a weak role drags
  synthesis down"): keep the **strongest model as the independent synthesizer/
  judge**, not as one equal voice in a debate that can degrade it. Validates our
  asymmetric panel→synthesizer design over a flat debate-of-equals.
- **Mandatory-challenge + role rotation as an anti-sycophancy pattern.** If we
  ever add a panel-debate round, requiring _two_ challengers and rotating who
  leads operationalizes the GDP anti-sycophancy rule from `RESEARCH.md` Paper 2:
  positions must survive scrutiny rather than win by being first/loudest.

### What is relevant for us

- **It studies our exact deployment class.** 7–9B local models are precisely what
  many fusion-local-proxy users run. The finding that orchestration helps weak
  models but not strong ones is directly actionable for how users should _compose
  a panel + pick a synthesizer_ given local hardware.
- **Reframes "fusion" honestly per-model:** the gain isn't uniform. Users with one
  strong local model and several weaker ones should likely make the strong one
  the synthesizer and let the panel supply diverse-but-weaker perspectives,
  rather than expect every model to benefit equally.
- **Scope caveat:** small benchmark, narrow task (ambiguity), and "success rate"
  on a constructed dataset. Treat as a qualitative signal about _model-dependence_
  and the _ambiguity-detection use case_, not as transferable numbers.

---

## Paper 8 — Do We Truly Need So Many Samples? Multi-LLM Repeated Sampling Efficiently Scales Test-Time Compute (ModelSwitch)

- **Link:** https://ojs.aaai.org/index.php/AAAI/article/view/39094
  (preprint: https://arxiv.org/abs/2504.00762)
- **Authors / venue:** Jianhao Chen, Zishuo Xun, Bocheng Zhou, Han Qi, Hangfan
  Zhang, Qiaosheng Zhang, Yang Chen, Wei Hu, Yuzhong Qu, Shuyue Hu (Nanjing
  University / Shanghai AI Lab) — AAAI 2026

> A different multi-LLM paradigm from debate: **repeated sampling + voting across
> diverse models**, with **consistency as a free confidence/routing signal**. Its
> efficiency results are a strong argument that _adaptive compute over diverse
> models_ often beats both brute-force single-model sampling and full debate.

### Techniques used

1. **Multi-model repeated-sampling-then-voting (ModelSwitch).** Instead of
   sampling one model `K` times, split the budget across `n` _diverse_ models
   (`K/n` each). Two twists: (i) include multiple models — even weaker ones — for
   complementary strengths; (ii) use **answer consistency as a signal to switch
   models and stop early**.
2. **Consistency↔accuracy as the core empirical law.** Across six LLMs and
   multiple datasets, the **entropy (consistency) of a model's sampled answers
   strongly correlates with accuracy** (moderate-to-high `r`, p < 0.001). High
   consistency → confidently correct (stop sampling); chaotic answers → the model
   "doesn't know" → **switch to another model**.
3. **Early-exit algorithm.** Query model 1 with `K/2` samples; if it is
   self-consistent, accept and **save the rest of the budget**; otherwise query
   model 2 and aggregate. Models are ordered strongest→weakest. The two-model
   switch is provably **lossless** vs. mixing equal samples, but cheaper.
4. **Weighted voting.** Aggregate with **internal weights `Wα`** (auto-computed
   entropy-based confidence — a model that answers consistently counts more) ×
   **external weights `Wβ`** (prior performance — stronger models count more).

### Key findings

- **A few diverse models beat one strong model brute-forced.** On MATH,
  ModelSwitch hit **81% with ~35 samples**, beating Gemini 1.5 Flash's 79.8% at
  512 samples (**~14× cheaper**). A 9B+8B pair matched a 70B model with **7
  samples**. It **outperformed self-consistency and SOTA multi-agent debate** on
  most of the datasets while cutting average sampling ~34%.
- **Diversity > scale; prioritize different models over versions of one.**
  Complementary strengths from different training corpora/paradigms are the
  source of the gains.

### What can be used in this project

- **Consistency as a cheap confidence signal — the most portable idea here.** Two
  flavors fit our pipeline:
  - _Cross-panel agreement_ (do panelists agree?) — we already have these outputs;
    quantifying their spread gives the synthesizer/judge a confidence cue
    (low spread → trust consensus; high spread → verify), echoing
    `RESEARCH.md` Papers 1 & 3.
  - _Within-model consistency_ (sample one panelist a few times) — a per-model
    "does this model know?" signal we don't currently compute.
- **Adaptive compute / early-exit.** ModelSwitch's "stop when consistent" is the
  same lever as `RESEARCH.md` Paper 1's adaptive stopping: when the panel is
  confidently consistent, **skip the judge and use a lighter synthesis path**;
  reserve the full panel→judge→synthesis spend for low-consistency (hard) inputs.
  This maps onto our already-optional judge.
- **Weighted aggregation as a synthesizer prior.** `Wα × Wβ` (consistency ×
  historical strength) is a concrete recipe we could hand the synthesizer:
  _trust panelists that were internally consistent and that are historically
  strong on this kind of task._ Even without literal sampling, the principle —
  weight candidates by confidence and track record, don't treat them equally — is
  a useful refinement to `synthesis-prompt.ts`.
- **Validates modest local-model panels.** "Combine a few comparable models
  instead of paying for one giant" is the economic thesis of running a local
  ensemble proxy. Good support for our core value proposition.

### What is relevant for us

- It is the **strongest efficiency argument** in either batch: diverse-model
  ensembling with adaptive stopping beat both brute-force sampling and debate at
  lower cost. This reinforces the cross-cutting recommendation to **adopt
  adaptive-compute before investing in multi-round debate.**
- The **consistency↔accuracy law** gives our "disagreement is a signal" intuition
  an empirical, quantitative footing and a ready-made metric (answer entropy).
- **Scope caveat (important for us):** ModelSwitch targets tasks with
  **discrete, checkable answers** (math, MCQ) where "consistency of the answer"
  is well-defined. Our open-ended generation/coding traffic makes answer-level
  consistency fuzzy — we'd need a semantic notion of agreement (embeddings / NLI,
  cf. `RESEARCH.md` Paper 2's CARA) to apply the consistency signal faithfully.

---

## Cross-cutting takeaways (this batch + links to Part 1)

1. **Base-model strength + diversity beat orchestration cleverness (Papers 5,
   6, 8).** Point budget at a strong synthesizer/judge and a _diverse_ panel
   before adding elaborate debate machinery; structural knobs (order, confidence
   visibility, depth) barely helped (Paper 5).
2. **Debate is not a universal good — and can hurt strong models (Papers 5, 7).**
   Its value is overturning a _wrong_ consensus, which requires a strong,
   independent reasoner. This is the empirical case for our asymmetric
   panel→authoritative-synthesizer design over a flat debate-of-equals.
3. **Shared misconceptions are not fixed by more similar models (Paper 6).** Hard
   theoretical backing for cross-family panel diversity and judge independence —
   complements the self-preference-bias finding in `RESEARCH.md` Paper 3.
4. **Turn agreement/consistency into a routing + confidence signal (Papers 5, 8;
   ties to `RESEARCH.md` 1, 3).** Cheap to compute, enables adaptive compute
   (skip the judge when the panel is confidently consistent; escalate when it
   disagrees) and weighted aggregation (consistency × track record).
5. **Concrete, shippable building blocks surfaced here** (largest → smallest
   effort): an embedding-based **quality/diversity prune** over panel results
   before synthesis (Paper 6); a **consistency/agreement statistic** feeding
   adaptive compute + weighted synthesis (Paper 8); an explicit
   **ambiguity-detection / clarify-don't-guess** instruction and `Analysis` field
   (Paper 7). All are low-risk and mostly prompt- or embedding-level — no change
   to the hexagonal core.
