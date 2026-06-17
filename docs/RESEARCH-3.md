# Research Notes — Part 3

A third batch of external research relevant to **fusion-local-proxy**'s ensemble
pipeline (panel → judge → synthesizer). As in [`RESEARCH.md`](./RESEARCH.md) and
[`RESEARCH-2.md`](./RESEARCH-2.md), for each paper we cover the techniques it
introduces, which of those are usable in this project, and why they are relevant
to our specific architecture. The papers are numbered 9–12 to continue from those
files (Papers 1–4 and 5–8 live there).

Quick orientation on how this project maps to the multi-agent literature:

- Our **panel** = a set of independent base models run in parallel
  (`PanelRunner`), optionally steered with cognitive `thinkingMode`s
  (`lateral` / `vertical` / `systems` / `divergent`).
- Our **judge** = an LLM-as-a-Judge that emits a structured `Analysis`
  (`JudgeStep`, `analysis-schema.ts`, `judge-prompt.ts`).
- Our **synthesizer** = a meta-model / integrator that is the "final authority,
  not just a blender" (`SynthesizeStep`, `synthesis-prompt.ts`), with a
  `selfJudge` fallback when no judge is configured.

A practical lens unifies this batch: **we are a black-box, single-pass proxy.**
We call hosted backends (OpenAI / Anthropic / OpenRouter / local Ollama /
LM Studio) over their APIs, we do not fine-tune them, and we **fan out once** —
we do *not* run iterative debate where agents read each other across rounds. Two
of these papers (9, 11) propose white-box or RL-trained methods we cannot adopt
wholesale; one (10) is a theorem about *why iterative debate erodes reasoning*
that **validates our single-pass, evidence-anchored design**; and one (12) is the
closest academic mirror of our panel + synthesizer. The recurring takeaway:
**diversity and external grounding are the load-bearing levers; closed-loop
iteration among similar agents is a trap.**

---

## Paper 9 — Single LLM Debate, MoLaCE: Mixture of Latent Concept Experts Against Confirmation Bias

- **Link:** https://arxiv.org/abs/2512.23518
- **Authors / venue:** Hazel Kim, Philip Torr (University of Oxford) — arXiv 2025, cs.CL

> A white-box, inference-time method. Its *mechanism* (activation steering) is out
> of reach for our hosted backends, but its *diagnosis* — confirmation bias is a
> first-class failure mode that multi-agent debate **amplifies** — is directly
> load-bearing for a chat proxy that receives leading, opinionated prompts.

### Techniques used

1. **Confirmation bias as a latent-concept posterior shift.** Framing an LLM's
   output as a Bayesian mixture over latent concepts `θ`, a biased prompt
   ("What evidence *supports* that MSG is harmful?" vs. "What evidence
   *challenges*…") reweights posterior mass along two axes — **truth alignment**
   and **stance polarity** — and systematically distorts factual accuracy. The
   effect is large: negatively-biased phrasings drop TruthfulQA accuracy by
   9–12pp, and "cross-bias robustness" (correct under *all* phrasings) can fall
   to single digits.
2. **Contrastive Activation Addition (CAA) steering.** Extract a single steering
   direction `v` from contrastive prompt pairs (support vs. challenge) as the
   mean difference of last-token residual-stream activations, then intervene at
   inference: `h ← h + α·v`. Confirmation bias turns out to be **linearly
   decodable** (probe accuracy ~92%) even though it doesn't form clean clusters.
3. **MoLaCE = a Mixture-of-Experts over one base model.** "Experts" are the same
   model under different steering strengths `α ∈ {−3…3}`; a gate assigns weights
   by cosine similarity between the prompt and `v` (a Gaussian/RBF over `α`), and
   the token distributions are mixed each decoding step. This lets a **single
   LLM emulate debate internally** at a fraction of the cost. Key empirical
   nuance: the *optimal* `α` is per-prompt and long-tailed — **no single fixed
   intervention works**, which is why adaptive gating beats uniform ensembling,
   majority vote, and LLM-judge selection.
4. **Debate makes confirmation bias worse, not better.** Because all agents share
   the same biased prompt and correlated parameters, vanilla debate and
   majority-vote are *echo chambers*: on TruthfulQA, debate cut Phi's cross-bias
   robustness from 21% → 0.2%. MoLaCE recovers it; MoLaCE + a light debate
   (n=2) recovers it further.

### What can be used in this project

- **Reality check: activation steering is not available to us.** MoLaCE needs
  residual-stream access. Our `ChatModelPort` adapters talk to backends over
  chat APIs and treat them as black boxes, so the *method itself* is only a
  (large, speculative) future experiment for the local-weights case (Ollama),
  not something the current architecture can express. Don't over-promise it.
- **Black-box analogue: a stance-neutralization / reframing step.** The portable
  idea is that a leading prompt biases *every* panelist in the same direction.
  We could add an optional pre-panel step that rewrites the user's query into a
  neutral form (or fans out *complementary stances* — one panelist asked to argue
  for, one against a contested claim) so the panel's spread reflects the evidence
  rather than the prompt's framing. This is the API-level version of mixing over
  `±α`.
- **Diversity that targets correlated error, not just style.** Our `thinkingMode`s
  vary *cognitive style*; MoLaCE argues the more dangerous correlation on factual
  queries is *stance/confirmation*. A "devil's-advocate" or "steelman the
  opposite" mode would attack the failure mode our current modes don't.
- **Reinforces echo-chamber avoidance.** The paper is more empirical support for
  our **parallel, peer-blind panel** and the README warning against panels of
  same-family models: correlated agents under a biased prompt confidently
  converge on the wrong answer, and no downstream step recovers it unless it
  re-grounds independently (cf. Paper 10).

### What is relevant for us

- A chat proxy is *exactly* the setting where confirmation bias bites: users
  routinely ask leading questions ("why is X bad?"). This paper names the
  mechanism and shows the standard multi-model fix (debate/vote) backfires —
  which is an argument for our authoritative, verification-first synthesizer over
  any vote-style aggregation.
- It quantifies *why* "convergence ≠ correctness" specifically for biased inputs,
  complementing Paper 2 (the consistency illusion) in `RESEARCH.md`: there the
  problem was reasoning misalignment hiding behind agreement; here it's a shared
  prior skewing all agents the same way.
- **Caveat:** results are on small open models (Llama-3.1-8B, Mistral-7B,
  Phi-3-mini) and fact-checking QA with fixed ground truth. The directional
  lesson (neutralize leading prompts; diversify stance) transfers; the specific
  steering numbers do not, and the core method is white-box.

---

## Paper 10 — The Reasoning Trap: An Information-Theoretic Bound on Closed-System Multi-Step LLM Reasoning

- **Link:** https://arxiv.org/abs/2605.01704
- **Authors / venue:** Kwan Soo Shin (PolymathMinds AI Lab) — arXiv 2026, cs.CL

> The most architecturally validating paper in this batch. It proves that
> *iterative, closed-loop* debate can only **lose** evidence-grounding over
> rounds, and that the escape hatch is **re-injecting the source evidence** —
> which is precisely what our single-pass synthesizer (re-reading the original
> conversation) already does.

### Techniques used

1. **SFS (Supported Faithfulness Score).** A claim-level, *process* metric (not
   accuracy): decompose a response into atomic claims, then score each claim by
   the **product** of sentence-BERT cosine similarity *and* a DeBERTa-NLI
   entailment gate against the provided evidence `E`; average over claims. The
   product is the point — a claim must be both *about* and *entailed by* the
   evidence. Condition-level rankings are decomposer-invariant (Spearman ρ=1.0).
2. **Theorem 1 (the DPI bound).** Under standard multi-agent debate, the chain
   `E → O⁰ → O¹ → …` is Markov, so by the Data Processing Inequality the expected
   mutual information `I(E; Oᵗ)` — how much of the response is actually grounded
   in the evidence — is **non-increasing** across rounds, and *strictly*
   decreasing under any non-injective aggregation (e.g., majority vote). Iterating
   among same-parameter agents redistributes belief but **injects no new
   information about `E`**.
3. **The Debate Trap, measured.** Accuracy is preserved while faithfulness
   collapses: a conformity-vote variant keeps 88% of baseline accuracy but loses
   43% of SFS; majority-vote debate drops SFS to **1.7% of baseline** (a
   structural "vote-aggregation floor": once you compress to a `K`-way verdict,
   `I(E;O) ≤ log₂K` regardless of how rich `E` was). Crucially, **factuality ≠
   faithfulness** — FActScore actually ranks debate *above* the grounded method,
   because debate produces fluent, individually-true sentences whose chain is
   ungrounded.
4. **Four conditions + the escape.** The trap requires: (i) shared `θ`,
   (ii) `E` provided once with no re-injection, (iii) step `t+1` depends only on
   step `t`, (iv) symmetric aggregation. **Self-Consistency and Mixture-of-Experts
   are explicitly *outside* the bound** (independent sampling / distinct `θ`).
   **EGSR (Evidence-Grounded Socratic Reasoning)** breaks it: a Debater →
   Questioner → Checker pipeline where the Checker **re-consults the external
   evidence every round**, turning faithfulness into a sub-martingale and
   recovering 98% of baseline SFS.
5. **Human ratings are an unstable yardstick.** A cross-language cohort found
   inter-rater faithfulness agreement near chance (Fleiss κ ≤ +0.018) with large
   intra-rater drift — so SFS is positioned as a more stable, decomposer-invariant
   anchor than human labels.

### What can be used in this project

- **Strongest argument yet for *not* adding iterative debate.** Our pipeline is
  single-pass (panel → judge → synth); panelists never read each other. This
  paper says that property is a feature: any "panel round 2" where panelists
  condition on peers would put us inside the Markov chain and start eroding
  grounding. If we ever prototype debate (floated in `RESEARCH.md` Paper 1),
  Theorem 1 is the reason to keep it bounded and evidence-anchored.
- **Keep the original conversation/source load-bearing in synthesis.** Our
  synthesizer already receives the **original messages**, not just panel
  summaries — that is the "re-inject `E`" move EGSR prescribes. The actionable
  refinement: for grounded tasks (RAG, tool output, coding with a spec), make
  sure the synthesizer and judge see the **actual source**, not panelists'
  paraphrases of it, so we stay an *open* system rather than collapsing to
  summaries-of-summaries.
- **An SFS-style faithfulness eval for grounded traffic.** When external evidence
  exists (provided docs, retrieved context, file contents), SFS is cheap to
  compute (embeddings + NLI, **no extra LLM calls**) and could run offline over
  panel and synthesized outputs to detect ungrounded synthesis — a concrete
  regression metric for tuning `synthesis-prompt.ts`. Complements the ERS eval
  idea from `RESEARCH.md` Paper 4.
- **Never reduce the pipeline to a vote of answers.** The vote-aggregation floor
  is direct evidence for our reasoning-synthesizer over majority/statistical
  aggregation (also supported by `RESEARCH.md` Paper 3).
- **Report grounding, not just "they agreed."** Where the judge has evidence to
  check against, prefer faithfulness-style signals over raw convergence.

### What is relevant for us

- We sit on the *good* side of this theorem by construction: a single fan-out
  plus a synthesizer that re-reads the source is an **open-system** design, the
  regime the paper proves is bounded *below* (recoverable) rather than above
  (eroding). Good external justification for the architecture as-is.
- The accuracy-vs-faithfulness split mirrors our own framing that the
  synthesizer's value is **verified integration**, not a higher score — and warns
  that "looks fluent and correct" can still be unfaithful to the inputs.
- **Caveat:** SFS needs an external evidence set `E`. For open-ended generation
  with no provided source, SFS isn't directly computable and Theorem 1's bound
  doesn't bite the same way — the results apply most cleanly to our grounded /
  RAG / coding-with-spec traffic, less to free-form creative chat.

---

## Paper 11 — Demystifying Multi-Agent Debate: The Role of Confidence and Diversity

- **Link:** https://arxiv.org/abs/2601.19921
- **Authors / venue:** Xiaochen Zhu, Caiqi Zhang, Yizhou Chi, Tom Stafford,
  Nigel Collier, Andreas Vlachos (University of Cambridge / University of
  Sheffield) — arXiv 2026, cs.CL

> Pinpoints the *two* missing ingredients that make debate work — **initial
> diversity** and **calibrated confidence** — and proves each fixes a different
> stage. The diversity half is a training-free recipe we can port directly to the
> panel; the confidence half is partly prompt-level and partly RL (which we can't
> do).

### Techniques used

1. **The martingale diagnosis (from Choi et al.).** With homogeneous agents and
   unweighted belief updates, vanilla debate is a **martingale** over the belief
   in the correct answer: `E[pₜ | ℱₜ₋₁] = pₜ₋₁`. In expectation, debate **neither
   helps nor hurts** — explaining why it often fails to beat majority vote despite
   far higher cost. Modeled as a Dirichlet–categorical process.
2. **Diversity-aware initialization (training-free).** Instead of sampling `N`
   initial answers, sample a larger pool `N_cand` (=10) and **greedily pick the
   `N` most distinct** to seed the debate. Proposition 1: this raises the prior
   probability that a correct hypothesis is present without changing the update
   dynamics. Empirically it lifts Pass@5 substantially (Qwen 0.79 → 0.91;
   Llama 0.74 → 0.90) and increases the count of unique initial answers.
3. **Confidence-modulated debate (RL-trained).** Agents emit a discrete
   confidence `w ∈ {0…10}` *and* condition their updates on peers' confidence.
   Confidence is **weighted into the aggregation, not the content**. Theorem 1:
   if confidence positively correlates with correctness, weighting turns the
   martingale into a **sub-martingale** — belief drifts toward the correct answer.
   Calibration + perception are trained via RL (GRPO + LoRA) with a BCE-style
   calibration reward plus a correctness reward, because verbalized LLM confidence
   is otherwise systematically overconfident.
4. **Empirical pattern.** Diversity alone already beats majority vote; diversity +
   confidence is best across six QA benchmarks. Debate helps **more on harder
   datasets**, which *naturally* produce more diverse initial answers — initial
   diversity is significantly (if weakly) correlated with the performance gain.

### What can be used in this project

- **Diversity-aware initialization → panel construction.** This is the most
  directly portable idea in the batch and it is **training-free and
  black-box-compatible**. Concretely: oversample candidates (across our diverse
  panel models and/or `thinkingMode`s and/or a couple of samples each), then feed
  the judge/synthesizer a **deduplicated, maximally-distinct subset** rather than
  near-identical answers. It operationalizes our existing "panel diversity"
  advice with a concrete selection rule, and it raises the chance the right
  answer is *present* for the synthesizer to recognize.
- **Confidence as a soft signal to the judge/synthesizer (prompt-level only).**
  We can ask panelists to emit a self-confidence score and surface per-candidate
  confidence to the judge/synthesizer so it can *weight* rather than *count*
  candidates — complementing the judge's `preferredCandidate`/`recommendation`.
  **Important honesty caveat:** the paper's whole point is that *uncalibrated*
  verbalized confidence is unreliable, and their fix is RL fine-tuning we cannot
  run. So treat panelist confidence as a weak prior the judge must cross-check,
  never as authority — consistent with our verification-first stance.
- **Adaptive compute via initial diversity.** "Debate helps most on hard,
  high-diversity inputs" → a cheap panel-spread statistic can route effort: high
  disagreement ⇒ run the full judge + authoritative synthesis; near-unanimity ⇒
  short-circuit to a lighter path. Reinforces the same adaptive-compute thread
  from `RESEARCH.md` (Papers 1, 3) and `RESEARCH-2.md` (Paper 8).
- **Diversity collapse is a real, named risk.** Post-training/alignment reduces
  sampling diversity — another reason to prefer **multiple model families** in the
  panel over many samples of one aligned model.

### What is relevant for us

- We are not iterative MAD, but both levers act on stages we *do* have:
  diversity-aware init is purely about *what enters the panel/synthesizer*, and
  confidence is about *how the integrator weights candidates*. Both compose with
  a single-pass design.
- The "correct hypothesis must be present at the start" framing echoes
  `RESEARCH.md` Paper 1's theorem (debate only helps if a correct seed exists):
  the synthesizer can only recognize/verify a good answer if some panelist
  produced one. Panel curation is upstream leverage.
- **Caveats:** the strongest confidence result needs model fine-tuning (out of
  scope for a hosted-backend proxy); evaluation is multiple-choice/QA with clean
  ground truth; and the diversity metric (count of distinct answers) is natural
  for MCQ but needs a semantic notion of "distinct" for our open-ended outputs.

---

## Paper 12 — Multi-LLM Collaborative Search for Complex Problem Solving (MoSA)

- **Link:** https://arxiv.org/abs/2502.18873
- **Authors / venue:** Sen Yang, Yafu Li, Wai Lam, Yu Cheng (CUHK) — arXiv 2025,
  ICML, cs.AI

> The closest academic mirror of our **panel (proposers) + synthesizer
> (aggregator)** split — just embedded inside Monte Carlo Tree Search. Its
> aggregator prompt is almost word-for-word our synthesis philosophy, and its
> "use different models for free diversity" finding validates multi-backend
> panels. The MCTS backbone is a large architectural departure we'd treat as a
> research direction, not near-term.

### Techniques used

1. **Mixture-of-Search-Agents (MoSA).** Multiple *distinct* LLMs act as agents in
   step-wise MCTS reasoning (built on RAP / rStar). Two roles:
   - **MoSA as Proposers:** different LLMs propose diverse sub-questions and
     sub-answers at each search node. Because the models have *different output
     distributions*, this yields better diversity than a single LLM with
     temperature/top-k/top-p tuning — which is finicky and can still get stuck in
     local optima.
   - **MoSA as Aggregators:** a neural **aggregator LLM** reads all candidate
     sub-answers and synthesizes a refined one, replacing heuristic majority
     voting. Intuition (and a worked example): an aggregator that sees *at least
     one* good candidate tends to produce a good output, so aggregation increases
     the number of good candidates before the final vote.
2. **Search + ensemble synergy.** Applied alone, multi-agent collaboration and
   search each give modest gains; combined, the gains are larger than either
   in isolation. Best config (Proposers + Aggregators) tops all four benchmarks
   (e.g., MATH-500 +1.8% over the best baseline), with the biggest wins on the
   **hardest** datasets.
3. **More distinct LLMs → higher accuracy** (with mild diminishing returns, e.g.
   3→4 models on MATH-500). Ablation: **proposer diversity matters more than
   aggregator diversity** (−1.23% vs −0.47% when collapsed to a single model).
4. **The aggregator prompt** (Appendix B) instructs: synthesize into one
   high-quality response; *critically assess — some responses may be biased or
   incorrect*; *do not merely echo* the candidates; produce a refined, accurate,
   well-organized answer. That is essentially our synthesizer's contract.

### What can be used in this project

- **Direct cross-validation of our core design.** MoSA's *proposers + aggregator*
  is our *panel + synthesizer*; its aggregator prompt is our `synthesis-prompt.ts`
  philosophy (don't echo, critically assess, some candidates are wrong, produce a
  refined answer). Independent confirmation that this beats majority-voting the
  candidates.
- **"Different models give free diversity."** Strong support for **multi-backend
  panels** over single-model-high-temperature: distinct distributions diversify
  proposals without the brittle sampling-parameter tuning a single model needs.
  Reinforces our README guidance and the `fusion.config.json` multi-provider
  design.
- **Even a modest aggregator helps if ≥1 good candidate exists.** Supports the
  "lightweight synthesizer is viable" note from `RESEARCH.md` Paper 3 and the
  panel-curation theme (the synthesizer's job is much easier when the panel
  surfaced at least one strong answer).
- **Panel size ≈ 3–4 diverse models** is a reasonable default; accuracy rises
  with distinct models but flattens — useful for cost guidance, consistent with
  the "5–7" range other papers report for larger ensembles.
- **Step-level search is a (big) future direction, not a near-term change.** An
  optional MCTS loop where the panel proposes reasoning steps and the synthesizer
  aggregates per step could help on hard math/coding, but it conflicts with our
  streaming, single-pass, latency-sensitive design and adds major complexity.
  File it under "research," and note the tension with Paper 10: MoSA iterates,
  but each aggregation re-reads the actual candidate *content* and the original
  question (and search re-grounds via the reward), so it is more "open-system"
  than vote-only debate — our single-pass synth is safer still.

### What is relevant for us

- It is the most concrete external instance of "multiple LLMs propose, one LLM
  integrates," embedded in a stronger reasoning harness. Confirms the fusion
  premise and our division of labor between panel and synthesizer.
- The proposer-diversity-dominates finding aligns with every other paper in these
  notes: **upstream diversity is the highest-leverage knob**, and the integrator
  is most valuable when fed diverse, partially-correct material.
- **Caveats:** evaluated on math/commonsense QA with verifiable answers and small
  open models (7–9B); the headline gains (~1.7% avg) are real but modest; and the
  benefits are entangled with the MCTS search machinery, so the *aggregator* and
  *multi-model proposer* lessons transfer to us more cleanly than the absolute
  numbers do.

---

## Cross-cutting takeaways for fusion-local-proxy (Part 3)

1. **Our single-pass, peer-blind, source-re-reading design is the right one
   (Paper 10).** Closed-loop debate among similar agents provably erodes
   evidence-grounding; re-injecting the original source/conversation is the
   escape hatch, and our synthesizer already does it. Don't add iterative panel
   debate without bounding it and re-grounding every round.
2. **Upstream diversity is the dominant, portable lever (Papers 9, 11, 12).**
   The single most shippable idea is a **diversity-aware panel**: oversample
   candidates and feed the judge/synthesizer a maximally-distinct, deduplicated
   subset (Paper 11), prefer **multiple model families** over one aligned model
   at high temperature (Paper 12), and diversify *stance*, not just style, to
   fight confirmation bias (Paper 9).
3. **Confirmation bias is a real risk for a chat proxy, and debate amplifies it
   (Paper 9).** Consider an optional prompt-neutralization / complementary-stance
   step before fan-out; never "fix" a biased prompt by voting more similar models.
4. **Confidence can be a *soft* weighting signal — but only that (Paper 11).**
   Surfacing panelist self-confidence to the judge/synthesizer is cheap and
   prompt-level, but verbalized confidence is uncalibrated without RL (which we
   don't do), so the integrator must cross-check it, not trust it.
5. **Keep the reasoning synthesizer; never collapse to a vote (Papers 10, 12).**
   The vote-aggregation floor (Paper 10) and MoSA's aggregator-beats-voting result
   (Paper 12) both argue for our authoritative integrator over statistical
   aggregation.
6. **Adaptive compute keyed on panel disagreement (Paper 11).** Debate/fusion pays
   off most on hard, high-diversity inputs; route the full judge + synthesis
   budget there and short-circuit near-unanimous easy ones — the same thread as
   `RESEARCH.md` (Papers 1, 3) and `RESEARCH-2.md` (Paper 8).
7. **Feasibility honesty.** As a black-box, non-fine-tuning, single-pass proxy we
   **cannot** directly use activation steering (Paper 9 / MoLaCE) or RL-trained
   confidence calibration (Paper 11), and MCTS search (Paper 12) is a large
   future experiment. The immediately usable items are: diversity-aware panel
   selection, stance neutralization, an SFS-style grounding eval for RAG/coding
   traffic, soft confidence signals, and disagreement-based adaptive compute.
