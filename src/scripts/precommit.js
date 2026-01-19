#!/usr/bin/env bun

/**
 * Precommit hook that runs code quality checks.
 * Use --verbose flag to see full output from all checks.
 */

import { COMMON_STEPS, runSteps } from "#toolkit/code-quality/runner.js";

const verbose = process.argv.includes("--verbose");
const rootDir = process.cwd();

// Steps to run for precommit
const steps = [
  COMMON_STEPS.install,
  COMMON_STEPS.lintFix,
  COMMON_STEPS.cpd,
  COMMON_STEPS.test,
];

console.log(
  verbose
    ? "Running precommit checks (verbose)...\n"
    : "Running precommit checks...",
);

runSteps({ steps, verbose, title: "PRECOMMIT SUMMARY", rootDir });
