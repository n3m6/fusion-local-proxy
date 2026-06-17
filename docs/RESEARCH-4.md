# Research Notes (Part 4)

Summaries of external research relevant to **fusion-local-proxy**'s ensemble
pipeline (panel → judge → synthesizer). For each paper we cover the techniques
it introduces, which of those techniques are usable in this project, and why
they are relevant to our specific architecture. This continues the series in
`RESEARCH.md`, `RESEARCH-2.md`, and `RESEARCH-3.md`.

Quick orientation on how this project maps to the multi-agent literature:

- Our **panel** = a set of independent base models run in parallel
  (`PanelRunner`), each isolated from the others (no peer visibility),
  optionally steered with cognitive `thinkingMode`s
  (`lateral` / `vertical` / `systems` / `divergent`).
- Our **judge** = an LLM-as-a-Judge that emits a structured `Analysis`
  (`JudgeStep`, `analysis-schema.ts`, `judge-prompt.ts`).
- Our **synthesizer** = a meta-model / integrator that is the "final authority,
  not just a blender" (`SynthesizeStep`, `synthesis-prompt.ts`), with a
  `selfJudge` fallback when no judge is configured.

These four papers share one blunt message that is unusually load-bearing for
our design: **inter-agent "debate" (agents reading and reacting to each other,
round after round) is mostly a bad idea — and where multi-agent systems help,
the gains come from independent ensembling plus a strong, principled
aggregator, not from the conversation between agents.** Our pipeline already
runs the panel *independently and in a single pass* and routes everything
through an authoritative synthesizer, so these papers mostly validate existing
choices while suggesting concrete, measurable refinements.

---

## Paper 13 — Debate or Vote: Which Yields Better Decisions in Multi-Agent Large Language Models?

- **Link:** https://proceedings.neurips.cc/paper_files/paper/2025/hash/934252acd87f254d5d4672fbde283bd2-Abstract-Conference.html
  (arXiv: https://arxiv.org/abs/2508.17536)
- **Authors / venue:** Hyeong Kyu Choi, Xiaojin (Jerry) Zhu, Yixuan (Sharon) Li,
  University of Wisconsin–Madison — NeurIPS 2025 (Spotlight)

### Techniques used

1. **Component disentanglement.** Multi-Agent Debate (MAD) is split into two
   ingredients — *Multi-Agent* (ensembling, measured by **majority voting** over
   the agents' initial answers) and *Debate* (the iterative inter-agent
   communication on top). They measure each component's contribution across
   seven benchmarks (Arithmetic, GSM8K, MMLU Pro-Med & Formal-Logic, HellaSwag,
   CommonsenseQA, HH-RLHF), three debate topologies (Decentralized, Sparse,
   Centralized), `N=1..5` agents, and `T=2/3/5` rounds.
2. **Headline finding.** *Majority voting alone accounts for most of MAD's
   gains.* Debate usually fails to beat plain voting; **Centralized MAD** (one
   agent aggregates everyone each round) often *hurts* badly. Accuracy rises
   with the number of agents `N` — i.e. the benefit is the **ensemble effect**,
   not the conversation.
3. **A Bayesian model of debate.** Each agent is a Dirichlet-Compound-Multinomial
   generator (Dirichlet prior = internal belief, Multinomial = sampling noise).
   A debate round is a Bayesian posterior update from neighbors' answer counts.
   - **Theorem 1 (voting power):** majority-vote success probability is lower
     bounded and approaches 1 as `N` grows, *even when the correct answer is only
     marginally the most likely* — voting magnifies a thin margin `Δ`.
   - **Theorem 2 (martingale):** an agent's expected belief in the correct
     answer is a **martingale** — it stays flat in expectation across rounds.
     Debate neither systematically improves nor degrades correctness; it just
     injects stochastic peer influence. *Voting does essentially all the work.*
4. **How to make debate actually help.** Bias belief updates toward the correct
   signal: **MAD-oracle** (lock an agent once it is correct — an upper bound),
   and the practical **MAD-Conformist** (keep your answer if it matched the
   majority) and **MAD-Follower** (30% chance to adopt the previous majority).
   All beat vanilla MAD — i.e. *the win comes from preserving/amplifying the
   majority's correct signal*, not from richer argumentation.
5. **Generality + a measurement warning.** The result holds on a larger 32B
   model, on heterogeneous persona agents (personas gave only small gains), and
   on open-ended summarization. Appendix F shows that **brittle answer parsing
   can fabricate apparent MAD gains**; a standardized output format
   (`{final answer: X}`) removes the artifact.

### What can be used in this project

- **Validation of "independent panel + strong aggregator" over debate.** We
  deliberately do *not* let panelists talk to each other; this paper is direct
  evidence that the conversation rarely adds value and a single aggregation pass
  captures the benefit. Keep the single-pass design; resist adding inter-panel
  debate rounds.
- **Treat panel agreement as a first-class signal, but let the synthesizer
  override.** The MAD-Conformist/Follower interventions are crude proxies for
  what our reasoning synthesizer does properly: *anchor on the panel's
  consensus, but only when warranted.* We can compute a cheap majority/agreement
  count over panel answers and pass it to the synthesizer as a prior ("N of M
  candidates converged on X") — while keeping its authority to override.
- **Ensemble-size guidance.** Gains come from `N` and taper; `N≈5` is the
  paper's main setting. Useful sizing intuition for default panel configs.
- **Harden answer extraction.** Appendix F is a direct caution for `JudgeStep`'s
  JSON parsing and for however we pull a clean final answer: parsing failures can
  silently corrupt evaluation. We already strip code fences and validate against
  `analysisSchema`; this paper argues that robustness there is load-bearing, not
  cosmetic.

### What is relevant for us

- The **martingale result** tempers the pitch: our value-add must come from the
  *judge's independent verification* and the *synthesizer's reasoning/override*,
  not from agents persuading each other. That is exactly where we put it.
- **Centralized MAD hurting** is a cautionary mirror of a naive synthesizer that
  re-reads everyone and re-emits each round. Our synthesizer runs **once** over
  independent outputs, which sidesteps that failure mode.
- Theorem 1's precondition — voting only recovers the right answer if it is the
  *modal* belief — restates our panel-diversity + override requirement: if the
  panel's majority is wrong, no vote-like aggregation recovers it; you need an
  independent authority (judge/synth that verifies) to escape the consensus.

---

## Paper 14 — Talk Isn't Always Cheap: Understanding Failure Modes in Multi-Agent Debate

- **Link:** https://arxiv.org/abs/2509.05396
- **Authors / venue:** Andrea Wynn, Harsh Satija, Gillian K. Hadfield
  (Johns Hopkins / Vector Institute) — ICML MAS Workshop 2025

### Techniques used

1. **Heterogeneous-debate evaluation.** MAD across CommonsenseQA, MMLU, and
   GSM8K with *mixed-capability* agent groups — GPT-4o-mini (strong),
   Llama-3.1-8B (mid), Mistral-7B (weak), `N=3`, `T=2` — comparing "w/o debate"
   (majority vote on initial answers) against "after debate."
2. **Debate can degrade accuracy.** Debate frequently produces *worse* results
   than no-debate voting, especially with mixed-capability agents; on
   CommonsenseQA debate *always* hurt. **A single weak agent drags down an
   otherwise strong group**, and performance keeps degrading over rounds.
3. **Answer-transition analysis.** Tracking correct→incorrect vs.
   incorrect→correct flips, they find debate produces **more correct→incorrect
   flips than the reverse** — it actively corrupts agents that started right.
   Round 2 is worse than round 1 (cumulative damage).
4. **Social conformity, not reasoning.** The probability of a harmful
   correct→incorrect flip is *highest when an agent is isolated* (no peers agree)
   and drops as more peers agree — i.e. agents fold to social pressure rather
   than to better arguments.
5. **Anti-sycophancy prompt fails.** A "correctness payoff" prompt (you are paid
   for matching ground truth; maximize payoff) **did not reduce** harmful flips —
   in several cases it *increased* them. Naive prompt-level incentives are
   insufficient.
6. **Prescription.** Future debate should promote *critical evaluation over
   consensus*: assess the soundness of others' reasoning, **weight contributions
   by credibility/expertise**, reward independent verification, and penalize
   unsupported conformity. They also cite work showing a confident, vivid *false*
   answer can fool an LLM judge (persuasion overrides truth).

### What can be used in this project

- **The strongest external argument for our independent, parallel, no-peer-
  visibility panel.** Peer exposure is precisely what triggers correct→incorrect
  flips here; because `PanelRunner` never shows panelists each other's outputs,
  we structurally avoid this failure mode. This is a design choice to defend, not
  revisit.
- **Weight candidates by reliability, not by count.** "Weight by expertise"
  maps to an optional per-model trust/reliability weight (from config or observed
  accuracy) that we surface to the judge and synthesizer — so a known-weak
  panelist's vote does not get equal footing. The judge already picks a
  `preferredCandidate`; reliability weighting makes that less of a popularity
  contest.
- **Calibrate skepticism toward confident-but-wrong candidates.** The
  "persuasion beats truth" result is a direct risk for `JudgeStep`. Our
  judge-prompt's existing demand for `trigger` + `evidence` and independent
  verification is the right mitigation — keep scoring by *grounding*, not by tone
  or confidence.
- **Don't over-trust prompt-only anti-sycophancy.** `RESEARCH.md` (Paper 2 there)
  recommended a GDP-style anti-sycophancy clause; this paper shows a bare payoff
  prompt didn't fix conformity. Keep the clause, but treat *structural
  independence* (our panel) as the reliable defense and the prompt as a
  secondary one.

### What is relevant for us

- **"A weak agent disrupts a strong group"** reinforces panel curation: a
  misconfigured or under-powered panelist is not free — it adds a candidate the
  judge/synthesizer must actively discount, and (per Paper 13) can shift the
  modal answer. Ties to the README's diversity/curation guidance.
- The harm was worst on knowledge/commonsense tasks (CSQA, MMLU) — squarely
  inside the open-ended chat/coding traffic we serve. So "more interaction =
  worse" is a real risk for us, and another reason not to bolt on inter-panel
  debate by default.

---

## Paper 15 — Multi-LLM Systems Exhibit Robust Semantic Collapse

- **Link:** https://arxiv.org/abs/2605.17193
- **Authors / venue:** Weiyi Kong, Shiyang Lai, Jinghua Piao, James Evans
  (Toronto / Chicago / Tsinghua) — arXiv 2026, cs.MA

> Not a "how to build it" paper — a "what closed loops fundamentally can't do"
> paper. Its lesson is about a design *anti-pattern* we should keep avoiding.

### Techniques used

1. **Closed-loop simulation.** Three LLM instances (GPT-4o-mini, DeepSeek-V3,
   Phi-4) take turns talking for up to **1,000 rounds** with *no task, no goal,
   no human* — only a short-term buffer and a RAG long-term memory. They measure
   **lexical diversity** (cumulative unique unigrams) vs. **semantic diversity**
   (cosine distance of each window's embedding from the start, plus cross-run
   dissimilarity), using `text-embedding-3-large`.
2. **"New words, same ideas."** Vocabulary grows steadily, but *meaning stays
   anchored near the opening*: ~0.75 similarity to the start late in the run vs.
   ~0.29 for human Reddit threads (≈3× more anchored). The collapse is
   reproducible across seeds and model families, and the late plateau is
   **predictable from the first 50 rounds** (saturating-exponential fit,
   MAE 0.053) — structured contraction, not drift.
3. **Twelve interventions, all fail.** Across 45 conditions: temperature
   0.5–2.0, output budget, RAG packing policy, six prompt rewrites (including
   *explicitly instructing diversity*), rich expert personas, mixed model
   families, **alignment removal** (uncensored variants), **sycophancy steering**
   (−58% measured sycophancy via activation steering), **GRPO RL** rewarding
   semantic novelty, `N=10` agents, alternative frameworks (AutoGen,
   AgentSociety), and stochastic perturbations. After Bonferroni correction,
   **zero** produced a significant increase in semantic diversity.
4. **The RL counter-result.** Training directly for novelty diversifies for ~2
   rounds, then snaps back — and **cross-run similarity *rises*** (0.5 → 0.8):
   forcing diversity made independent runs look *more* alike.
5. **Mechanism.** **Induction heads** (look-back-and-copy circuits) grow louder
   and more confident as history lengthens (759 events, logit margin ≈3.92),
   while the **rare-token tail is forgotten** (bottom-10% survival ≈11% by window
   20 vs. >90% for common tokens) — positive feedback toward the center of the
   distribution. Collapse is *directional*: different models settle into
   different basins, and a model-attribution classifier gets *more* accurate
   (~94%) over time — collapse **sharpens** model identity.
6. **Theory.** Framed via the Data Processing Inequality (a closed chain cannot
   create information), exponential entropy contraction (more rounds won't
   escape — the attractor is geometric), and an Algorithmic Lovelace Bound (at
   most logarithmically many genuinely-novel bits). Closed loops are
   "subcritical."

### What can be used in this project

- **Keep the pipeline single-pass; never close the loop.** Our panel → judge →
  synthesizer flow has no agent-to-agent feedback rounds, so it is not subject to
  round-over-round collapse. This paper is the formal reason *not* to add an
  iterative panel-debate / self-talk loop (reinforcing Papers 13 & 14).
- **The useful signal comes from *outside* the loop.** The only thing that
  escapes the bound is fresh external information. For us that means: (a) the
  user's actual prompt/conversation is the exogenous signal the synthesizer is
  anchored to; (b) **maximize panel diversity across model families**, since
  different families occupy different basins; and (c) where appropriate, ground
  answers in *retrieved external context* (RAG) rather than internal
  recombination.
- **A cheap panel-collapse diagnostic.** Compute pairwise embedding cosine across
  panel outputs: if the candidates are near-identical, the "ensemble" has
  collapsed onto one basin and is adding nothing. This complements the NMAE
  redundancy pruning from `RESEARCH.md` (Paper 3 there) and operationalizes the
  README's diversity advice.
- **Set realistic expectations for `thinkingMode`s and "be diverse" prompts.**
  Prompt-level diversity steering (and even RL for diversity) cannot manufacture
  genuine semantic novelty in a closed loop. `thinkingMode`s are valuable for
  *seeding* distinct starting points in our single pass — not for inventing
  content no model could reach.

### What is relevant for us

- **Strongest argument yet for cross-family panels.** A single-family panel (or
  several variants of one model) collapses to one basin; the synthesizer then
  sees no real diversity. Reinforces the README's "different models for panel,
  judge, synth" guidance, and the self-preference concern (sharpened model
  identity) for keeping the judge/synth out of the panel's family.
- Our synthesizer is a **one-shot aggregator over independent outputs plus the
  original user input** — explicitly an *open* step with fresh external signal,
  not a closed loop. Good. If we ever add agentic memory or multi-turn
  self-refinement, this paper is the warning label.
- **Honesty about emergence.** Fusion *verifies and integrates*; it does not
  "originate" net-new ideas beyond what the panel + user input supply. This
  agrees with `RESEARCH.md` (Paper 4 there) on low "emergent value."

---

## Paper 16 — Multi-Agent Collaborative Intelligence (MACI): Dual-Dial Control for Reliable LLM Reasoning

- **Link:** https://arxiv.org/abs/2510.04488
- **Authors / venue:** Edward Y. Chang, Ethan Y. Chang (Stanford / UIUC) — arXiv
  2025, cs.AI

> The most constructive of the four: it accepts that naive debate is wasteful and
> redesigns orchestration around *measurable* signals and a calibrated stop. Much
> of its machinery is portable to our single-pass pipeline as judge/synthesizer
> signals, even though we don't run multi-round debate.

### Techniques used

1. **Two orthogonal control "dials."** An **information dial** (`τ`) gates which
   evidence agents may cite by quality, and a **behavior dial** (`CL`) schedules
   contentiousness from *exploration* (challenge aggressively) to *consolidation*
   (build on agreements). Decoupling *what information enters* from *how agents
   behave* is the core idea.
2. **Four measurement signals.** A moderator tracks **evidence quality `Q`**
   (cosine of cited spans to a target prototype), **disagreement `D_JS`**
   (Jensen–Shannon divergence between agents' answer distributions), **support
   overlap `O`** (Jaccard of cited evidence sets — convergence of *evidence*, not
   just beliefs), and **argument quality `CRIT`** (a cross-family LLM judge). A
   **dual admission gate** only accepts arguments passing both `Q≥τ_Q` and
   `CRIT≥τ_CRIT`; agents are reliability-weighted by an EMA of their `CRIT`.
3. **Measured stopping.** Stop when information-gain and disagreement **plateau**
   (relative-progress ratios) for several rounds *and* evidence quality/overlap
   are sufficient. Theory-lite guarantees: dispersion is non-increasing,
   termination in `O(1/ε)` rounds; a budget-feasible UCB scheduler gives
   `Õ(√KT)` no-regret under a token budget.
4. **Adaptive initialization.** Initial contentiousness is set from the initial
   `Q` and `D_JS` — easy/clear queries start consolidative, ambiguous/conflicting
   ones start exploratory — to avoid burning compute on easy cases.
5. **Judge robustness as a discipline.** `CRIT` is a **cross-family** judge with
   **agent identities masked**, **span-grounded justifications** required, and a
   small **judge panel (`K≥3`) with reliability weighting**. It is order-invariant
   and stable under judge swaps (2–3% winner flips), and is used as a *soft
   weight + part of a compound stop rule*, **not a hard oracle**.
6. **Results.** Clinical diagnosis (1,500 cases, *unconstrained* 100+ disease
   space): +3.9 pp over majority vote, +3.7 pp over fixed-contentiousness debate,
   better calibration (ECE 0.081 vs. 0.103), and **19% fewer tokens** (vs. ~5–7×
   more for vote-of-20 / self-consistency-20). Ablations: removing the `Q` gate
   −5.2 pp, uniform (no reliability) weights −3.0 pp, no scheduling −3.9 to
   −6.0 pp. News-bias (619 articles): the same controls cut the partisan gap 68%
   cross-domain with no tuning. Residual uncertainty is converted into a
   **precision-RAG plan** (what to retrieve next).
7. **Regime classification.** Orchestration is for **large answer spaces**
   (`|Y|≥20`) needing evidence synthesis and uncertainty; for **small
   multiple-choice** (`|Y|≤5`), majority voting suffices and voting degrades as
   the answer space grows.

### What can be used in this project

- **Add MACI-style signals to our (single-pass) judge + synthesizer.** Even
  without debate rounds we can compute, over the panel's outputs: **disagreement
  `D_JS`** (spread across candidate answers) and **support overlap `O`** (do
  candidates cite the same grounds — pairs naturally with the GDP grounding idea
  from `RESEARCH.md`). Surface both to the judge and synthesizer prompts as a
  quantitative confidence cue, complementing the judge's qualitative
  `discrepancies`.
- **Weight candidates by argument quality, not vote count.** A `CRIT`-like
  per-candidate quality score (the judge can produce it) lets the synthesizer
  weight a well-grounded minority answer over a poorly-grounded majority —
  directly addressing Paper 13/14's "voting is blind to reasoning quality."
- **Judge-hygiene checklist — portable to `JudgeStep` today:**
  - *Mask candidate identities to the judge.* Label panel outputs "Candidate
    A/B/C" instead of "claude-3.5 / gpt-4o / …" to cut self-preference and brand
    bias. (Note: `RESEARCH.md`'s Paper 3 *included* model identity and observed
    self-preference; masking is the fix.) This is a cheap, concrete new change.
  - *Require span-grounded justifications* — we already demand `trigger`/
    `evidence`; generalize it.
  - *Treat the judge as a soft signal, not an oracle* — already our posture
    (`JudgeStep` returns `null` on failure; the synthesizer is the authority, and
    `selfJudge` runs with no judge at all).
- **Adaptive compute via a difficulty/regime check.** MACI's regime rule (vote
  suffices for small/clear answer spaces; orchestrate for large/ambiguous ones) +
  its agreement-based initialization is the concrete version of the
  "adaptive-compute" thread from `RESEARCH.md` (Paper 1 there): cheaply estimate
  panel agreement up front, then *short-circuit* easy/high-consensus queries
  (skip the judge, light synthesis) and reserve the full path for
  high-disagreement ones.
- **Expose calibration / "what would resolve this."** MACI reports ECE/Brier and,
  when uncertain, emits a precision-RAG plan instead of an overconfident guess.
  Analogously, when the panel disagrees and uncertainty is high, our synthesizer
  could state its confidence and ask a targeted clarifying question (or list what
  external info would settle it) rather than bluffing.

### What is relevant for us

- MACI explicitly builds on Paper 13 (Choi et al.) and adopts the **regime view**:
  voting for small answer spaces, orchestration for open-ended ones. Our traffic
  is open-ended generation/coding — exactly where the judge + synthesizer earn
  their cost; but for trivially-clear queries a lighter path is justified.
- **"Decouple information from behavior"** mirrors our separation of *generation*
  (the diverse panel = information) from *decision* (the authoritative
  synthesizer = behavior). MACI's contribution is making the decision
  **measurable**; our judge/synth are currently more qualitative.
- **Judge-as-soft-weight, not oracle** cross-validates our design where the
  synthesizer (not the judge) is the final authority and the judge is optional.
- **Cost honesty.** MACI is ~2.7× a single call but far cheaper *and* more
  accurate than brute-force vote-of-20 / self-consistency-20. That supports our
  "small curated panel + one judge + one synthesizer" shape over heavy sampling.

---

## Cross-cutting takeaways for fusion-local-proxy

1. **Independent parallel ensembling + a strong aggregator beats inter-agent
   debate (Papers 13, 14).** Voting ≈ debate (P13) and debate often *harms* (P14).
   Our no-peer-visibility, single-pass panel is the right call — do not add
   multi-round panel debate by default.
2. **Closed loops collapse and cannot create novelty (Paper 15).** The fresh
   signal must come from outside the loop — the user's input, cross-family panel
   diversity, and optionally retrieved external context. Keep the pipeline
   single-pass; beware any future agentic memory/iteration.
3. **Voting is a strong baseline but blind to reasoning quality and fails on
   large/open-ended answer spaces (Papers 13, 16).** Our reasoning judge +
   synthesizer is the principled upgrade for exactly our regime — and our regime
   (open-ended) is where simple voting isn't even well-defined.
4. **Make orchestration measurable (Papers 14, 16).** Compute panel disagreement
   (`D_JS`-style spread) and reasoning/evidence overlap, surface them to the
   judge and synthesizer, and **weight candidates by argument quality, not vote
   count.** Use agreement to gate compute adaptively.
5. **Judge hygiene (Papers 14, 16).** Cross-family judge, **anonymize candidate
   identities** to the judge, require grounded justifications, and treat the judge
   as a soft signal — the synthesizer stays the final authority. Lowest-effort
   new win here: masking model identities from the judge.
6. **Panel curation matters more, not less (Papers 13, 14, 15).** Cross-family
   diversity seeds distinct basins (P15), a weak panelist drags the group (P14),
   and the correct answer must be representable in the panel for any aggregation
   to recover it (P13). Reinforces the README's diversity + judge-independence
   guidance.
7. **Be honest about what fusion does.** Prompt-only anti-sycophancy is necessary
   but not sufficient (P14); structural independence (our design) is the reliable
   defense. And fusion *verifies and integrates* — it does not *originate* (P15).
