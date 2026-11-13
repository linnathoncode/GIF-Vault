---
name: code-clarity
description: Refactor existing code to make it clearer, easier to read, and easier to maintain without changing intended behavior. Use for code cleanup, readability improvements, simplifying complex logic, improving names, reducing nesting, or preparing legacy code for review. Do not use for feature work, performance tuning, dependency upgrades, or intentional behavior changes unless explicitly requested.
---

# Code Clarity

Refactor code in small, behavior-preserving steps. Optimize for how quickly a developer can understand the code, not for shorter files or functions.

## Establish the baseline

Before editing:

1. Identify the target files or feature area.
2. Read the target code, its immediate callers, relevant types, tests, and documentation.
3. Determine the current public API, data formats, side effects, error behavior, and project conventions.
4. Run the narrowest relevant tests when practical so existing failures are distinguishable from regressions.
5. Identify concrete clarity problems before proposing structural changes.

If intended behavior is unclear, investigate before editing. Ask the user when ambiguity would affect behavior or architecture.

## Refactor for clarity

Make the smallest coherent set of changes that materially improves readability.

Prefer:

- names that express purpose;
- early returns over deeply nested conditions;
- direct, unsurprising code over clever or compressed code;
- existing project conventions;
- top-down feature organization, with entry points and orchestration functions before supporting helpers when the language and project conventions allow it;
- keeping closely related logic together;
- removing duplication when the shared concept is stable and the result is easier to follow;
- extracting a function or file when it has a clear independent responsibility and meaningful reuse or separation value.

Avoid:

- broad rewrites when focused edits are enough;
- changing public APIs, data formats, errors, or side effects;
- new dependencies unless explicitly requested;
- formatting-only churn outside the target;
- comments that narrate obvious statements;
- microfiles that contain only a small fragment of one coherent feature;
- microfunctions created only to reduce line count;
- splitting a readable flow across several files or helpers without a clear ownership boundary.

Do not use a rigid line-count or call-count threshold. Reuse is a strong reason to extract, but a helper used once or twice is justified only when it gives a useful name to genuinely complex logic or creates a clear responsibility boundary. A moderately long function is acceptable when keeping the flow together makes it easier to understand.

Keep or add comments only when they explain a non-obvious constraint, decision, invariant, or workaround.

## Review each change

After each meaningful refactor:

1. Review the diff for accidental behavior changes and unrelated churn.
2. Confirm that names, boundaries, and control flow are easier to understand.
3. Remove abstractions that add indirection without enough clarity or reuse.
4. Preserve the project's established architectural boundaries unless the user approves a redesign.

## Verify

Run the narrowest relevant checks first:

1. Targeted tests for the changed feature.
2. Type checking, linting, or formatting checks used by the project.
3. Broader tests or builds when shared code is affected.

If verification is unavailable, state what was not run and why. Never imply behavior was preserved solely because the refactor looks equivalent.

## Stop and ask

Pause before proceeding when:

- multiple valid designs have materially different trade-offs;
- the refactor would change behavior, a public API, stored data, or error handling;
- tests contradict the implementation or expected behavior;
- a broader redesign is required;
- project conventions or ownership boundaries are unclear.

## Report the result

Start with the outcome, then report:

- **Readability improvements:** what became clearer and why.
- **Behavior:** whether behavior and public contracts were preserved.
- **Verification:** commands or checks run and their results.
- **Remaining opportunities:** important cleanup deliberately left out of scope.
