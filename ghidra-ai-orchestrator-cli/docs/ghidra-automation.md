# Ghidra automation via the APT CLI

This repo now ships a headless Ghidra tool suite so the orchestrator can import binaries, run analysis, and execute custom scripts (for vulnerability sweeps or offensive patching) without leaving the CLI.

## Prerequisites

- Point `GHIDRA_INSTALL_DIR` (or `GHIDRA_HOME`) at a built Ghidra install that contains `support/analyzeHeadless`. If you built from this repo, target the generated install root; otherwise use an existing Ghidra distribution.
- The tools will fall back to the local `Ghidra/RuntimeScripts` checkout, but a full install is recommended for reliable analysis.

## Available tools

- `ghidra_locate_installation` — Resolves the runnable `analyzeHeadless` script using `install_dir`, `GHIDRA_INSTALL_DIR`, or the repo checkout.
- `ghidra_write_script` — Writes a reusable Ghidra script under `.apt/ghidra/scripts`. Supports Jython (`python`) and Java (`java`) scripts.
- `ghidra_run_headless` — Imports a binary, optionally skips auto-analysis, and runs a post script (inline or on-disk). Use `analysis_args` to pass native flags like `-overwrite` or `-analysisTimeoutPerFile`.

## Common flows

### Fast vuln triage with an inline script

```bash
apt "/tools ghidra_run_headless binary_path=bin/target.exe no_analysis=false inline_script='#!/usr/bin/env python\nfrom ghidra.program.model.listing import Function\nfm = currentProgram.getFunctionManager()\nfor func in fm.getFunctions(True):\n    stack = func.getStackPurgeSize() if func.hasStackFrame() else 0\n    print(f\"{func.getEntryPoint()} {func.getName()} stack={stack}\")' analysis_args='[\"-overwrite\"]'"
```

The CLI will:

1. Resolve `analyzeHeadless` (preferring `GHIDRA_INSTALL_DIR`).
2. Create a project in `.apt/ghidra-projects`.
3. Run the inline script as a `-postScript`, letting you add heuristics for dangerous imports, RWX sections, or gadget harvesting.

### Reusable offensive/defensive scripts

```bash
apt "/tools ghidra_write_script file_name=rop_harvest language=python contents='from ghidra.program.model.address import Address\n# enumerate gadgets, collect offsets, etc.'"
apt "/tools ghidra_run_headless binary_path=bin/target.exe script_path=.apt/ghidra/scripts/rop_harvest.py analysis_args='[\"-overwrite\"]'"
```

### Cleanup

Add `delete_project=true` to discard the temporary project after each run. Projects live under `.apt/ghidra-projects` by default.

## Notes

- Outputs include the full `analyzeHeadless` command plus stdout/stderr for reproducibility.
- Analysis timeout defaults to 5 minutes; override via `timeout_ms` for larger firmware images.
- Because arguments are passed as discrete argv entries, headless runs are safe to parameterize without shell injection risk.
