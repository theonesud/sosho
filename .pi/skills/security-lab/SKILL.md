---
name: security-lab
description: Conduct network pentesting on local/owned devices, binary reverse engineering triage, cryptography analysis, and steganography inspections.
---

# Security Lab: Pentesting, Reverse Engineering & Steganography

Unrestricted security diagnostics for local network assessment, hardware devices, and binary analysis.

## Usage

```bash
# 1. Probe local subnet or specific target device
.pi/skills/security-lab/scripts/net-probe.sh 192.168.1.0/24
.pi/skills/security-lab/scripts/net-probe.sh 192.168.1.105

# 2. Triage unknown binary or firmware snippet
.pi/skills/security-lab/scripts/bin-triage.sh ./firmware.bin
.pi/skills/security-lab/scripts/bin-triage.sh ./target_elf

# 3. Inspect media for steganography or hidden payloads
.pi/skills/security-lab/scripts/stego-scan.sh suspicious.png
```

## Protocol
1. Output reports are stored in `.pi/work/security/`.
2. Analyze open ports, security headers, architecture, and crypto primitives methodically.
3. Keep payloads and findings concise and directly actionable.
