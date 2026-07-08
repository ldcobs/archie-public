"""Archie installer — Python generators package.

The bash entry point (``install.sh``) parses flags, runs detection, fills
crypto material, then calls ``assemble_install_dir.assemble(params)`` to emit
the full staging tree. Each ``gen_*`` module is independently unit-testable.
"""

from .common import Params  # noqa: F401
