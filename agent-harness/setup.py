"""PyPI packaging for the Datus cli-anything harness.

PEP 420 namespace package: ``cli_anything/`` has NO ``__init__.py``;
``cli_anything/datus/`` does. Other cli-anything packages (gimp, blender, ...)
install side-by-side under the same ``cli_anything`` namespace.

Hard dependency (NOT in install_requires, see README.md):
    The Datus agent framework itself — ``pip install datus-agent`` (Python >= 3.12),
    or the one-liner installer. The harness invokes the real Datus API in-process
    and is useless without it.
"""

from setuptools import setup, find_namespace_packages

setup(
    name="cli-anything-datus",
    version="1.0.0",
    description="Stateful CLI harness for the Datus data engineering agent (NL-to-SQL)",
    long_description=open("cli_anything/datus/README.md", encoding="utf-8").read(),
    long_description_content_type="text/markdown",
    packages=find_namespace_packages(include=["cli_anything.*"]),
    install_requires=[
        "click>=8.0.0",
        "prompt-toolkit>=3.0.0",
        "PyYAML>=6.0",
    ],
    package_data={
        "cli_anything.datus": ["skills/*.md", "README.md"],
    },
    entry_points={
        "console_scripts": [
            "cli-anything-datus=cli_anything.datus.datus_cli:main",
        ],
    },
    python_requires=">=3.12",
)
