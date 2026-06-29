#!/usr/bin/env bash
# Gopher — install the opt-in git pre-push hook (EP-0004).
# The hook runs the local verification entrypoint (`make check`) so breakage is caught
# before it leaves the machine. No cloud CI, no external account.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
hook_dir="$repo_root/.git/hooks"
hook_file="$hook_dir/pre-push"

if [[ ! -d "$repo_root/.git" ]]; then
  echo "error: $repo_root is not a git repository" >&2
  exit 1
fi

mkdir -p "$hook_dir"
cat > "$hook_file" <<'HOOK'
#!/usr/bin/env bash
# Gopher pre-push verification. Bypass (discouraged) with: git push --no-verify
set -euo pipefail
repo_root="$(git rev-parse --show-toplevel)"
echo "[pre-push] running 'make verify' …"
if ! make -C "$repo_root" verify; then
  echo "[pre-push] verification failed — push aborted. Fix issues or use --no-verify." >&2
  exit 1
fi
echo "[pre-push] verification passed."
HOOK

chmod +x "$hook_file"
echo "Installed pre-push hook at $hook_file"
echo "It runs 'make verify' before every push. Bypass with 'git push --no-verify'."
