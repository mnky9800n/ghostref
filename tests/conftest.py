"""
Pytest configuration and fixtures for CitationLint tests.
"""

import pytest


def pytest_addoption(parser):
    """Add custom command line options."""
    parser.addoption(
        "--update-baseline",
        action="store_true",
        default=False,
        help="Regenerate baseline expected results",
    )


@pytest.fixture
def update_baseline(request):
    """Fixture to check if --update-baseline was passed."""
    return request.config.getoption("--update-baseline")
