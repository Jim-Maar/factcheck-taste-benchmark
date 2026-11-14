# Previous work

## Community Notes and LLMs

- Li, H., De, S., Revel, M., Haupt, A., Miller, B., Coleman, K., Baxter, J., Saveski, M., & Bakker, M. A. (2025). Scaling human judgment in Community Notes with LLMs. *Journal of Online Trust and Safety, 3*(1). https://arxiv.org/abs/2506.24118
  - Proposes AI note writers, with human raters deciding which notes are shown, and training models on the raters' feedback. This is the setting we benchmark.
- Li, H., & Bakker, M. A. (2026). AI fact-checking in the wild: A field evaluation of LLM-written Community Notes on X. *arXiv:2604.02592*. https://arxiv.org/abs/2604.02592 ([project page](https://haiwen-li.github.io/ai-fact-checking-in-the-wild/))
  - 1,614 LLM notes on X, rated as helpful as or more helpful than human notes. A foil for us: high helpfulness ratings don't rule out taste failures.
- De, S., Bakker, M. A., Baxter, J., & Saveski, M. (2025). Supernotes: Driving consensus in crowd-sourced fact-checking. In *Proceedings of the ACM Web Conference 2025 (WWW '25)*. https://arxiv.org/abs/2411.06116
  - An LLM writes candidate notes, and a simulated jury of raters picks the best one.
- Xing, R., Nakov, P., Baldwin, T., & Lau, J. H. (2026). COMMUNITYNOTES: A dataset for exploring the helpfulness of fact-checking explanations. In *Findings of EACL 2026*. https://aclanthology.org/2026.findings-eacl.71
  - About 105k posts with helpfulness labels and reason labels. Models predict *whether* a note is helpful better than *why*, which motivates a taxonomy.
- Wu, J., Fu, Z., Wang, H., Li, F., Guo, J., Nakov, P., & Kan, M.-Y. (2025). Beyond the crowd: LLM-augmented Community Notes for governing health misinformation. *arXiv:2510.11423*. https://arxiv.org/abs/2510.11423
  - Evaluates notes in three stages: relevance, then correctness, then helpfulness. Reports that raters often confuse fluent style with accuracy. This supports judging taste separately from accuracy.
- Razuvayevskaya, O., Tayebi, A., Sørensen, U. D., Bontcheva, K., & Rogers, R. (2025). Timeliness, consensus, and composition of the crowd: Community Notes on X. *arXiv:2510.12559*. https://arxiv.org/abs/2510.12559
  - About 68% of noted posts are flagged "Note Not Needed". This counts a post when any one rating or note flags it. So "no note was needed" is a common judgement on human notes too.
- Wojcik, S., Hilgard, S., Judd, N., Mocanu, D., Ragain, S., Hunzaker, M. B. F., Coleman, K., & Baxter, J. (2022). Birdwatch: Crowd wisdom and bridging algorithms can inform understanding and reduce the spread of misinformation. *arXiv:2210.15723*. https://arxiv.org/abs/2210.15723
  - The bridging algorithm behind Community Notes' scoring.

## Where we're novel

Earlier work asks whether LLM notes are accurate or rated helpful overall. We ask a simpler question: are accurate LLM notes still bad notes, and in which ways? For example: pedantic, or missing the joke. We compare a few models on this.

Closest work:
- CANDY ([Guo et al., 2025](https://arxiv.org/abs/2509.03957)): flawed LLM fact-check explanations, mostly about faithfulness and reasoning.
- CriticGPT ([McAleese et al., 2024](https://arxiv.org/abs/2407.00215)): "nitpicks" as a failure of LLM critics, in code review.
