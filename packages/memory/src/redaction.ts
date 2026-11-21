const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  /\b(AKIA[0-9A-Z]{16})\b/g,
  /\b(github_pat_[A-Za-z0-9_]{20,})\b/g,
  /\b(eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g,
  /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^:\s/@]+:[^@\s/]+@)/g,
  /\b(sk-[a-zA-Z0-9_-]{20,})\b/g,
  /\b(pk-lf-[a-zA-Z0-9_-]{8,})\b/g,
  /\b(sk-lf-[a-zA-Z0-9_-]{8,})\b/g,
  /\b(ghp_[a-zA-Z0-9]{20,})\b/g,
  /\b(hf_[a-zA-Z0-9]{20,})\b/g,
  /\b(AIza[0-9A-Za-z_-]{30,})\b/g,
  /\b(Bearer\s+[A-Za-z0-9._-]{20,})\b/gi,
  /\b([A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|PASSWORD)\s*=\s*[^\s"'`]{8,})/g,
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    if (re.source.includes(":\\/\\/")) {
      out = out.replace(re, "$1[REDACTED_SECRET]@");
    } else {
      out = out.replace(re, "[REDACTED_SECRET]");
    }
  }
  return out;
}
