"""PowerShell variable names are case-insensitive: $Config and $config are one variable.
A case-only clash in the installer once made it write config.json to the wrong place."""
import re
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent.parent
ASSIGN = re.compile(r"(?<![\w$])\$([A-Za-z_]\w*)\s*(?:=|\+=)(?!=)")
PARAM = re.compile(r"\[[^\]]*\](?:\[[^\]]*\])*\s*\$([A-Za-z_]\w*)")


@pytest.mark.parametrize("name", ["install.ps1", "uninstall.ps1"])
def test_no_case_only_variable_clash(name):
    text = (HERE / name).read_text(encoding="utf-8")
    names = set(ASSIGN.findall(text)) | set(PARAM.findall(text))
    seen: dict[str, set[str]] = {}
    for n in names:
        seen.setdefault(n.lower(), set()).add(n)
    clashes = {k: sorted(v) for k, v in seen.items() if len(v) > 1}
    assert not clashes, f"{name}: names differing only by case: {clashes}"
