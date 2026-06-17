# Research Notes

Summaries of external research relevant to **fusion-local-proxy**'s ensemble
pipeline (panel → judge → synthesizer). For each paper we cover the techniques
it introduces, which of those techniques are usable in this project, and why
they are relevant to our specific architecture.

Quick orientation on how this project maps to the multi-agent literature:

- Our **panel** = a set of independent base models run in parallel
  (`PanelRunner`), optionally steered with cognitive `thinkingMode`s
  (`lateral` / `vertical` / `systems` / `divergent`).
- Our **judge** = an LLM-as-a-Judge that emits a structured `Analysis`
  (`JudgeStep`, `analysis-schema.ts`, `judge-prompt.ts`), already built around
  the premise that _convergence is not correctness_.
- Our **synthesizer** = a meta-model / integrator that is the "final authority,
  not just a blender" (`SynthesizeStep`, `synthesis-prompt.ts`), with a
  `selfJudge` fallback when no judge is configured.

A recurring theme across all four papers is directly load-bearing for us:
**answer-level agreement among models is a weak and sometimes misleading signal
of correctness.** Our prompts already encode this belief; these papers give it
empirical and theoretical backing and suggest concrete refinements.

---

## Paper 1 — Multi-Agent Debate for LLM Judges with Adaptive Stability Detection

- **Link:** https://arxiv.org/abs/2510.12697
- **Authors / venue:** Tianyu Hu, Zhen Tan, Song Wang, Huaizhi Qu, Tianlong Chen (arXiv 2025, cs.AI)

### Techniques used

1. **Multi-agent debate for LLM-as-judge.** Instead of running `n` judges once
   and aggregating with majority vote, agents see each other's responses and
   _iteratively refine_ their judgments over rounds; debate terminates early on
   unanimous agreement, otherwise runs to a max round count and falls back to
   majority vote.
2. **A Bayesian "latent concept" model of debate.** Each task has a hidden
   "true concept" `θ*`; agents update a posterior over concepts after seeing
   peers. They prove two theorems: (a) one strongly-correct response in a round
   raises expected correctness next round ("consistent response
   amplification"), and (b) the debated outcome beats the initial majority vote,
   _provided at least one agent starts from the correct concept_.
3. **Adaptive stability detection.** Judge correctness across a round is modeled
   as a **time-varying mixture of two Beta-Binomial distributions** (fit per
   round via Expectation-Maximization / L-BFGS-B). They detect convergence by
   the **Kolmogorov–Smirnov statistic** between consecutive rounds' CDFs and
   stop when `D_t < 0.05` for two consecutive rounds. This avoids both premature
   stopping and wasted rounds after consensus.
4. **Empirical tuning.** Ensemble size of **7** is the sweet spot (5 is often
   enough; ≥9 shows diminishing returns). Debate helps most on _hard,
   high-variance_ tasks; on easy/high-consensus tasks plain majority vote is
   comparable or better.

### What can be used in this project

- **Adaptive / conditional escalation.** Their headline practical insight —
  _spend extra compute only where it changes the answer_ — is directly
  actionable. Today our pipeline always runs the full panel + judge +
  synthesizer. We could add an early-exit: if the panel is already in strong
  agreement (and that agreement is trusted — see Paper 2's caveat), skip the
  judge and use a lighter synthesis path. The "stability" idea becomes a cheap
  panel-agreement check rather than a full Beta-Binomial fit.
- **Bimodal-consensus intuition for routing.** Their finding that debate
  distributions collapse to "all correct or all wrong" is a useful mental model:
  high panel agreement does **not** linearly map to correctness. This argues for
  treating _disagreement_ as the signal that warrants the expensive judge +
  authoritative-synthesis path.
- **An optional debate round between panel and judge.** For hard tasks we could
  add one bounded refinement round where panelists see a digest of the others'
  answers before the judge runs — a "panel round 2." This is a larger change and
  conflicts with our current strict-independence panel design (see relevance).

### What is relevant for us

- This is an **LLM-as-judge** paper, and we have an explicit judge stage. It
  validates moving _beyond majority voting_, which is exactly what our reasoning
  synthesizer does (it is an authoritative integrator, not a vote counter).
- The theory's key precondition — _debate only helps if at least one agent seeds
  the correct concept_ — reinforces our **panel-diversity** recommendation in
  the README: a homogeneous panel can confidently converge on a wrong concept
  and no amount of downstream processing recovers it.
- **Cost knobs to consider:** an "ensemble size ≈ 5–7" guideline and an
  adaptive stopping/early-exit rule are concrete, low-risk efficiency ideas that
  fit our heartbeat-streamed, per-stage-timed pipeline.
- **Caution:** full iterative debate adds rounds (latency + tokens) and
  partially abandons the independence of panel responses that our architecture
  deliberately preserves. Adopt the _adaptive-compute_ idea first; treat
  multi-round debate as an experiment, not a default.

---

## Paper 2 — The Consistency Illusion: How Multi-Agent Debate Hides Reasoning Misalignment

- **Link:** https://arxiv.org/abs/2606.08457
- **Authors / venue:** Xiaoyang Wang, Christopher C. Yang, Drexel University

> This is the single most directly relevant paper to our judge/synthesis prompt
> design.

### Techniques used

1. **CARA (Cross-Agent Reasoning Alignment).** A family of _post-hoc_ metrics
   (no extra LLM calls) that ask: among agents that agree on the _answer_, do
   they agree on the _reasoning_? Each rationale is split into steps; pairwise
   step alignment is scored with a hybrid of **NLI contradiction detection**
   (a contradiction hard-overrides similarity to −1) and **embedding cosine
   similarity**. They also report a **Contradiction Rate (CR)**.
2. **The "consistency illusion" finding.** Standard multi-agent debate _reduces
   visible contradictions (CR ↓) while also reducing reasoning similarity
   (SIM ↓)_ — agents look like they agree more but actually reason less
   consistently. Two mechanisms: **contradiction smoothing** (agents delete
   conflicting steps without adopting shared reasoning) and **sycophantic
   convergence** (an agent adopts the majority answer with _zero_ reasoning).
   Debate even _manufactures_ disagreement: the "no-majority" rate jumped ~38×
   after debate in one setting.
3. **Grounded Debate Protocol (GDP).** A pure **prompt-level** intervention (no
   architecture change, no extra calls, ~9% more output tokens) that forces each
   reasoning step into a structured triple:
   - **Claim** — a single atomic, falsifiable assertion.
   - **Ground** — a _named_ fact, mechanism, or guideline supporting the claim.
   - **Stance** — `Agree` / `Disagree` / `Extend` toward a specific peer claim;
     a `Disagree` must carry a counter-Ground.
     Plus an explicit **anti-sycophancy rule**: only change your answer if you find
     a factual error in your own reasoning or see a more compelling Ground. GDP
     produced large, consistent alignment gains (Cohen's d ≈ +1.43 to +1.99) and
     _eliminated_ both severe failure modes, while leaving answer accuracy roughly
     unchanged (it's an alignment/auditing intervention, not an accuracy booster).

### What can be used in this project

- **"Claim + Ground" grounding in our judge and synthesis prompts.** This is the
  highest-value, lowest-risk takeaway. Our `judge-prompt.ts` already demands a
  `trigger` and `evidence` per issue; GDP generalizes that discipline to _every_
  reasoning step. We could:
  - Ask **panelists** (especially on factual/coding tasks) to attach a named
    ground to key claims, making their rationales comparable and auditable.
  - Have the **judge** record, per agreement, _why each agreeing model believed
    it_ — turning our `agreements` array from "they converged" into "they
    converged for compatible/incompatible reasons."
- **Anti-sycophancy clause.** A near-verbatim port of GDP's rule belongs in our
  synthesis system prompt and (if we ever add a panel-debate round) the panel
  prompt: _do not adopt a position merely because others hold it._
- **A reasoning-alignment audit signal.** CARA is cheap (NLI + embeddings, no
  LLM calls) and could run on panel outputs to compute an **agreement-quality
  score**. Concretely: when panel models agree on an answer, check whether their
  reasoning actually aligns. Low alignment among "agreeing" models is a red flag
  the synthesizer should be told about — "these models agree on the answer but
  for contradictory reasons; verify independently."

### What is relevant for us

- It is **empirical proof of the exact assumption our prompts are built on.**
  `synthesis-prompt.ts` already says _"Convergence does not imply correctness"_
  and _"candidates trained on similar data share the same blind spots."_ This
  paper measures that effect and shows naive debate makes it _worse_, not
  better. It strongly justifies our design choice that the synthesizer is an
  authority that _independently verifies_ convergent claims rather than trusting
  agreement.
- The **failure-mode taxonomy** (complementary reasoning, sycophantic
  convergence, contradictory premises, granularity mismatch, terminology
  divergence) is a ready-made checklist for what the judge/synthesizer should
  watch for when summarizing panel `agreements` and `discrepancies`.
- The illusion is _larger on open-ended tasks_ with more room for reasoning to
  diverge — i.e., exactly the general-purpose chat/coding/open-ended traffic our
  proxy serves, not just constrained multiple-choice. So the risk is high for us.
- **Bonus:** GDP costs essentially nothing (prompt-only, ~9% tokens, no extra
  calls), which fits our "no architecture change" comfort zone. This is the most
  immediately shippable idea across all four papers.

---

## Paper 3 — A Large-Scale Empirical Study of LLM Orchestration and Ensemble Strategies for Sentiment Analysis in Recommender Systems

- **Link:** https://www.mdpi.com/1999-5903/18/2/112
- **Authors / venue:** Roumeliotis, Margaris, Spiliotopoulos, Vassilakis — _Future Internet_ 2026, 18(2):112

> Domain (sentiment/rating prediction) differs from ours, but its
> **meta-model aggregation** design is almost exactly our synthesizer, so the
> empirical findings transfer well.

### Techniques used

1. **Reasoning meta-model aggregation vs. statistical aggregation.** 12 base
   LLMs (OpenAI/Anthropic/Google/DeepSeek) each predict zero-shot; a
   **reasoning LLM "meta-model" (GPT-5 / GPT-5-mini)** then receives _both the
   base predictions and the original input text_ and produces the final answer
   with explanatory reasoning. This is benchmarked against majority voting, mean
   aggregation, and stacking.
2. **Headline result.** The meta-model reached **71.4%** vs. **62.6% majority
   vote / 63.0% mean / 61.3% average individual model** (statistically
   significant, McNemar p < 0.001). Reasoning-based aggregation beat statistical
   aggregation by ~8–9 points — and even beat a fine-tuned RoBERTa baseline.
3. **The meta-model's distinguishing capabilities** (vs. stacking): it sees the
   **original input** (not just votes), produces **explicit reasoning**, does
   **dynamic per-instance trust assessment**, and can **override the entire
   ensemble** when its own read of the text disagrees.
4. **Override / divergence analysis.** The meta-model matched the majority ~86%
   of the time, but _was more accurate when it diverged_ (77.7% vs 70.4%), and
   when it overrode the consensus entirely it was right 100% of the time in one
   variant. **Override is most valuable under high base-model disagreement**
   (disagreement = an implicit low-confidence signal). Decision _quality_ mattered
   more than override _frequency_ (GPT-5 mini overrode more but did worse).
5. **Influence / trust hierarchy.** Standalone accuracy strongly predicts a
   model's positive "influence" on the meta-model (Pearson r ≈ 0.97); weak models
   (here, Gemini Flash) are net-negative "outliers." The meta-model also showed
   **self-preference bias** — it trusted its own family most. Model identity
   (name) was included in the prompt.
6. **Consensus ↔ accuracy.** Accuracy rose monotonically with agreement:
   unanimous ≈ 80%, weak majority ≈ 47%, no majority ≈ 30%. Fleiss' κ ≈ 0.59.
7. **Redundancy pruning.** Highly similar model pairs (measured by **Normalized
   MAE** + agreement rate) are redundant; dropping one and reweighting kept
   accuracy. Suggested deployment patterns: **selective aggregation** (full
   ensemble only for hard/high-stakes inputs), **model pruning**,
   **confidence-based routing**, batch/parallel optimization.

### What can be used in this project

- **Strong validation of our synthesizer design — keep it.** Our synthesizer
  already does the four things their meta-model does (sees original conversation
  - panel responses, reasons explicitly, weighs candidates, can override). This
    paper is direct evidence that this beats the statistical-aggregation
    alternative we could have built instead.
- **Use panel disagreement as an explicit signal to the synthesizer.** Their
  cleanest, most portable finding: override pays off precisely when base models
  disagree. We could compute a cheap panel-spread/agreement statistic in
  `RunFusionUseCase` and surface it to the synthesizer (and judge) prompt:
  high agreement → lean toward the consensus unless contradicted; high spread →
  "treat consensus as unreliable, verify from the source." This complements the
  judge's `discrepancies` with a quantitative confidence cue.
- **Redundancy/diversity diagnostics for panel config.** NMAE + agreement-rate
  between panelists is a concrete tool to detect a redundant panel (e.g., two
  models from the same family that almost always agree) — operationalizing the
  README's panel-diversity advice and helping users prune cost without losing
  accuracy. Could be a debug-log metric or an offline analysis script.
- **Selective / tiered aggregation for cost.** "Full ensemble only when it
  matters" maps onto our optional-judge design and the adaptive-compute idea from
  Paper 1. We already make the judge optional; we could go further with
  confidence-based routing (small panel for easy inputs, full panel + judge for
  hard ones).
- **Lightweight synthesizer is viable.** GPT-5-mini nearly matched GPT-5 as the
  meta-model — _the aggregation architecture mattered more than the meta-model's
  raw strength._ Reassuring for users who run a modest synthesizer, though the
  README's "use your strongest model as synthesizer" advice is still defensible
  for the hardest tasks.

### What is relevant for us

- The **self-preference bias** they observed is a real risk for us: the README
  already warns against sharing a model family between judge and panel/synth.
  This paper quantifies _why_ — the aggregator over-trusts its own family. Good
  ammunition for keeping the judge independent from the panel.
- Their **consensus→accuracy** curve says agreement _is_ informative on
  easy/clear inputs — a useful counterbalance to Paper 2. The synthesis logic to
  aim for: _trust strong consensus by default, but escalate skepticism as
  agreement weakens or reasoning fails to align._
- **Scope caveat:** this is bounded, ordinal (1–5 star) classification on
  English Amazon reviews. Our traffic is open-ended generation/coding, where the
  override and consensus dynamics may differ (and where Paper 2's illusion is
  stronger). Treat the _direction_ of these findings as transferable, the exact
  numbers as not.

---

## Paper 4 — Cognitive Grounding for Perspective Integration in Multi-LLM Systems

- **Link:** https://www.mdpi.com/2073-431X/15/5/277
- **Venue:** _Computers_ 2026, 15(5):277

> This paper's architecture is essentially our pipeline named differently:
> **parallel independent specialists → a synthesizer that integrates them.**

### Techniques used

1. **Parallel Synthesis architecture.** Three cognitively specialized roles run
   **in parallel and in isolation** (no peer visibility), then a Synthesizer
   integrates them:
   - **Analyzer** — hierarchical decomposition (Simon).
   - **Creative** — divergent thinking: fluency, flexibility, originality
     (Torrance).
   - **Critic** — System-2 critical evaluation: find weaknesses, ambiguities,
     hidden complexities (Kahneman).
   - **Synthesizer** — distributed-cognition integrator (Hutchins): find
     convergence (treat as a reliability signal), resolve divergence _by
     evidence not majority_, build a unified answer preserving the reasoning
     chain.
     Roles are grounded in **cognitive functions, not personas** ("doctor",
     "engineer") — the paper cites evidence that superficial personas don't change
     reasoning, whereas cognitive-function prompts do.
2. **Independence by design.** Parallel execution is a deliberate choice to
   avoid the **anchoring bias** of sequential debate and to preserve cognitive
   diversity (mirrors our `PanelRunner`'s parallel fan-out exactly).
3. **Emergent Reasoning Score (ERS).** A composite metric splitting:
   - **Synthesis Effectiveness (SE):** fraction of each role's concepts that
     survive into the synthesized output (integration quality).
   - **Emergent Value (EV):** fraction of synthesized concepts that were in _no_
     role's output (genuinely novel reasoning).
     Concepts are extracted by a separate small LLM (10 per output) and compared
     set-theoretically with relaxed lexical matching; component weights are derived
     empirically from each component's correlation with accuracy.
4. **Key finding.** SE was high (~0.71–0.74) but EV was low (~0.10): the
   synthesizer **reliably integrates perspectives but rarely invents new
   concepts** (~90% of synthesized concepts already existed in a role output).
   Majority voting matched or slightly beat the synthesizer _on answer accuracy_,
   so the synthesizer's value is the **integrated, multi-perspective reasoning
   trace**, not a higher score on closed-form MCQs.

### What can be used in this project

- **Reframe / extend our `thinkingMode`s as cognitive roles.** We already inject
  `lateral` / `vertical` / `systems` / `divergent` system prompts per panelist.
  Paper 4's **Analyzer / Creative / Critic** triad is a theory-backed,
  complementary, _non-overlapping_ role set we could offer as additional modes
  (notably a **Critic / System-2** role — finding weaknesses — which we don't
  currently have and which pairs naturally with our convergence-skeptical judge).
  Their appendix prompts are concrete templates we can adapt.
- **Our `synthesis-prompt.ts` already matches their Synthesizer recipe.** Their
  3-step integration (converge → resolve-by-evidence-not-majority → unified
  response preserving the chain) is nearly identical to our instructions 3–4 and 10. This is strong cross-validation; their explicit wording
  ("when two roles reach the same conclusion via _different_ paths, treat that
  as a reliability signal") is a nice refinement to consider.
- **ERS as an offline evaluation harness.** SE/EV could be implemented as a test
  or eval script for _our_ synthesizer: does the final answer actually
  incorporate concepts from each panelist (high SE = not ignoring panelists), and
  how much does it add (EV)? This gives us a quantitative way to tune
  `synthesis-prompt.ts` and to detect a synthesizer that's silently ignoring the
  panel. Cheap-ish: needs one extra concept-extraction call per output.
- **Set expectations honestly.** Their result — integration ≫ emergence, and
  majority vote is competitive on accuracy — tempers any claim that fusion
  magically produces _new_ correctness. Our honest pitch should be: reliable,
  multi-perspective, _verified_ integration (and error-correction via the judge),
  not "the panel invents answers no model could reach."

### What is relevant for us

- **Independent parallel specialists + a dedicated integrator is our exact
  architecture.** This paper is essentially an academic write-up of the design
  decisions already in `PanelRunner` + `SynthesizeStep`, including the
  anchoring-avoidance rationale for parallelism. Good external justification.
- **Cognitive-function > persona** is a useful principle for how we word
  `thinking-modes.ts`: target the reasoning _process_, not a job title (our
  current modes already do this — keep it that way).
- **Diminishing returns when one role is weak.** They found a weak role (Critic
  on MMLU) _dragged synthesis down_ toward a diluted compromise. For us this
  reinforces: a weak/misconfigured panelist isn't free — it can pull the
  synthesizer toward a worse answer, so panel curation matters (ties back to
  Paper 3's outlier-pruning and our diversity guidance).
- **Cost honesty.** Their 8-calls-per-task overhead and the finding that
  majority vote is competitive on pure accuracy argue for the **adaptive-compute
  / tiered** approach (Papers 1 & 3): reserve the full panel+judge+synthesis path
  for inputs where multi-perspective reasoning actually earns its cost.

---

## Cross-cutting takeaways for fusion-local-proxy

1. **"Convergence ≠ correctness" is now well-supported (Papers 1, 2, 3, 4).**
   Our prompts already encode it; keep it and make it _quantitative_ by surfacing
   a panel-agreement/disagreement statistic to the judge and synthesizer.
2. **Highest-value, lowest-risk change: adopt GDP-style grounding + an
   anti-sycophancy clause (Paper 2)** in the panel/judge/synthesis prompts —
   prompt-only, ~no extra cost, directly extends our existing `trigger`/
   `evidence` discipline.
3. **Use disagreement as a routing/confidence signal (Papers 1, 3).** High
   agreement → trust consensus and consider skipping the judge (adaptive
   compute); high spread → escalate skepticism and run the full authoritative
   path. Override pays off most under disagreement.
4. **Keep the reasoning synthesizer; it beats statistical aggregation (Paper 3)** and reliably integrates perspectives (Paper 4) — but be honest that its
   value is _verified integration and error-correction_, not novel-answer
   generation.
5. **Panel curation matters (Papers 1, 3, 4).** Diversity seeds correctness
   (Paper 1's theorem), redundancy wastes money (Paper 3's NMAE pruning), and a
   weak panelist can drag synthesis down (Paper 4). Reinforces the README's
   panel-diversity and judge-independence guidance.
6. **Possible new building blocks** (largest → smallest effort): an optional
   bounded panel-debate round (Paper 1); a CARA-style reasoning-alignment audit
   over panel outputs (Paper 2); an ERS offline eval for the synthesizer
   (Paper 4); a Critic/System-2 `thinkingMode` (Paper 4); a redundancy/diversity
   diagnostic over panel predictions (Paper 3).
