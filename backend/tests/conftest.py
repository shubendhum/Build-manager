"""Shared helpers.

Several suites want "a real job to read", and reached for the first one the API
returned. Under the parallel runner that is a moving target: another worker's
scratch job can be created and deleted underneath you mid-test, and the suite
fails with a 404 that has nothing to do with what it was checking.
"""
import re

# Names the suites give their own throwaway jobs.
SCRATCH = re.compile(r"^(TEST_|NSTEST |BOARDTEST |CASCADE|GAPTEST|GAPSTEP|STEPSTEST|FRESH )")


def real_projects(projects: list) -> list:
    """The jobs that belong to the user, not to a test run."""
    return [p for p in projects if not SCRATCH.match(p.get("name", ""))]
