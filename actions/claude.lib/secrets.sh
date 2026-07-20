# Shared step shell for secret-scoping composites (infisical.secrets.scope).
# Sourced from a composite's step as
#
#   . "${GITHUB_ACTION_PATH}/../claude.lib/secrets.sh"
#
# Re-emits selected keys from a dotenv file as masked GitHub Actions step
# outputs, so a step gets only the secrets it names instead of the whole
# job-wide env block infisical.secrets.fetch's `export: env` mode produces.
# Infisical/secrets-action supports only export-type env|file — no step-output
# mode and no log masking — so this fills the gap: fetch to file, scope here.

# scope_secrets <dotenv-path> <SPEC>... — SPEC is INFISICAL_KEY:outputName.
# For every key present in the dotenv file, masks its value (::add-mask::)
# regardless of whether it was requested, so an unscoped secret never lands
# unmasked in the log. For each requested SPEC whose key is present, appends
# outputName=value to $GITHUB_OUTPUT. Removes the dotenv file when done.
scope_secrets() {
  local dotenv="$1"
  shift

  local spec key_wanted name_wanted
  local -A wanted=()
  for spec in "$@"; do
    key_wanted="${spec%%:*}"
    name_wanted="${spec#*:}"
    wanted["$key_wanted"]="$name_wanted"
  done

  local line key value
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" == *=* ]] || continue
    key="${line%%=*}"
    value="${line#*=}"
    [[ -n "$key" ]] || continue
    echo "::add-mask::${value}"
    if [[ -n "${wanted[$key]+x}" ]]; then
      echo "${wanted[$key]}=${value}" >> "$GITHUB_OUTPUT"
    fi
  done < "$dotenv"

  rm -f "$dotenv"
}
