#!/usr/bin/env python3
"""CI entry point kept under its original name (the workflow file is unchanged): runs the public-archive test of
the current release, test-public-231110.py."""
import pathlib, runpy
runpy.run_path(str(pathlib.Path(__file__).with_name('test-public-231110.py')), run_name='__main__')
