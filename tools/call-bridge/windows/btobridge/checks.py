"""`bridge doctor`: can this PC do the bluetooth mode? A Bluetooth radio that works, Phone Link
installed, a phone paired over Bluetooth, VB-Cable installed. Read-only, no administrator.

The Windows facts come from one PowerShell call (PnP devices, the Appx package list); the decision
and the owner's words are plain functions, tested on Linux.
"""

from __future__ import annotations

import json
import subprocess
import sys
from dataclasses import dataclass

#: One PowerShell line, JSON out. A radio is a Bluetooth-class device on a bus (USB, PCI, ...),
#: not one that the Bluetooth stack enumerates for a paired device (BTHENUM, BTHLE...).
PS = r"""
$ErrorActionPreference = 'SilentlyContinue'
$bt = @(Get-PnpDevice -Class Bluetooth -PresentOnly)
$radios = @($bt | Where-Object { $_.InstanceId -match '^(USB|PCI|ACPI|SD|SWD\\RADIO)' })
$paired = @(Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match '^BTHENUM\\' -and $_.InstanceId -match '111E|111F' })
$svc = (Get-Service bthserv).Status
$pl = @(Get-AppxPackage -Name 'Microsoft.YourPhone')
[pscustomobject]@{
  radios = $radios.Count
  radiosOk = @($radios | Where-Object { $_.Status -eq 'OK' }).Count
  handsfree = $paired.Count
  service = "$svc"
  phoneLink = $pl.Count
} | ConvertTo-Json -Compress
"""


@dataclass
class Facts:
    radios: int = 0
    radios_ok: int = 0
    #: Hands-free (HFP) devices: a phone paired over Bluetooth as an audio gateway.
    handsfree: int = 0
    service: str = ""
    phone_link: bool = False
    vb_cable: bool = False


@dataclass
class Finding:
    ok: bool
    text: str


def windows_facts() -> Facts | None:
    """None when this is not Windows or PowerShell did not answer."""
    if sys.platform != "win32":
        return None
    try:
        done = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", PS],
            capture_output=True,
            text=True,
            timeout=30,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        data = json.loads(done.stdout.strip() or "{}")
    except (OSError, ValueError, subprocess.SubprocessError):
        return None
    return Facts(
        radios=int(data.get("radios") or 0),
        radios_ok=int(data.get("radiosOk") or 0),
        handsfree=int(data.get("handsfree") or 0),
        service=str(data.get("service") or ""),
        phone_link=int(data.get("phoneLink") or 0) > 0,
    )


def has_vb_cable(output_names: list[str], input_names: list[str]) -> bool:
    outs = any("cable input" in name.lower() for name in output_names)
    ins = any("cable output" in name.lower() for name in input_names)
    return outs and ins


def findings(facts: Facts) -> list[Finding]:
    """The owner's words, one per thing to have; `ok` False is something to fix."""
    found: list[Finding] = []
    if facts.radios == 0:
        found.append(Finding(False, "Энэ компьютерт Bluetooth алга. USB Bluetooth адаптер (5.0+) залгана уу."))
    elif facts.radios_ok == 0:
        found.append(
            Finding(
                False,
                "Bluetooth төхөөрөмж байгаа ч ажиллахгүй байна (драйвер эсвэл унтраалттай)."
                " Settings → Bluetooth & devices-д Bluetooth-ийг асаана уу.",
            )
        )
    else:
        found.append(Finding(True, "Bluetooth ажиллаж байна."))
    if facts.service and facts.service.lower() != "running":
        found.append(Finding(False, "Windows-ийн Bluetooth үйлчилгээ зогссон байна. Компьютерээ дахин асаана уу."))
    if facts.phone_link:
        found.append(Finding(True, "Phone Link суусан байна."))
    else:
        found.append(
            Finding(
                False,
                "Phone Link суугаагүй байна. Microsoft Store-оос «Phone Link» (Microsoft) програмыг суулгана уу.",
            )
        )
    if facts.handsfree > 0:
        found.append(Finding(True, "Bluetooth-ээр холбогдсон утас (дуудлагын эрхтэй) байна."))
    else:
        found.append(
            Finding(
                False,
                "Утас Bluetooth-ээр холбогдоогүй (эсвэл дуудлагын эрх өгөөгүй) байна. Phone Link-д утсаа"
                " холбоод «Calls» хэсгийг тохируулна уу.",
            )
        )
    if facts.vb_cable:
        found.append(Finding(True, "VB-Cable суусан байна."))
    else:
        found.append(
            Finding(
                False,
                "VB-Cable суугаагүй байна. https://vb-audio.com/Cable/ хуудаснаас татаж, админаар суулгаад"
                " компьютерээ дахин асаана уу.",
            )
        )
    return found
