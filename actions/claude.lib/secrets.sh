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
#
# If any requested key is absent (including the empty/missing-file case),
# emits a single ::error:: line naming the absent keys and the found/requested
# count, then returns non-zero — an absent/empty fetch must fail loudly, not
# hand callers an empty credential. The error line never contains a fetched
# value; masking above already covers everything present in the file.
scope_secrets() {
  local dotenv="$1"
  shift

  local spec key_wanted name_wanted
  local -A wanted=()
  local -A found=()
  for spec in "$@"; do
    key_wanted="${spec%%:*}"
    name_wanted="${spec#*:}"
    wanted["$key_wanted"]="$name_wanted"
  done

  local line key value
  if [[ -f "$dotenv" ]]; then
    # Guarded on existence (not just fed to the redirection) so a genuinely
    # missing file falls through to the found/missing accounting below
    # instead of failing the redirection — which would abort this function
    # under the caller's real `set -e` before the crafted ::error:: line ever
    # runs (devkit#184 review).
    while IFS= read -r line || [[ -n "$line" ]]; do
      [[ "$line" == *=* ]] || continue
      key="${line%%=*}"
      value="${line#*=}"
      [[ -n "$key" ]] || continue
      # Infisical/secrets-action's `export: file` writes dotenv values wrapped in
      # single quotes (GH_BOT_PAT='ghp_…'); strip a matched surrounding quote pair
      # so consumers get the raw secret, not a 2-char-longer invalid string that
      # fails auth as a checkout/gh token.
      case "$value" in
        \'*\') value="${value#\'}"; value="${value%\'}" ;;
        \"*\") value="${value#\"}"; value="${value%\"}" ;;
      esac
      echo "::add-mask::${value}"
      if [[ -n "${wanted[$key]+x}" ]]; then
        echo "${wanted[$key]}=${value}" >> "$GITHUB_OUTPUT"
        found["$key"]=1
      fi
    done < "$dotenv"
  fi

  rm -f "$dotenv"

  local total=${#wanted[@]}
  local missing=()
  for key_wanted in "${!wanted[@]}"; do
    [[ -n "${found[$key_wanted]+x}" ]] || missing+=("$key_wanted")
  done

  if (( ${#missing[@]} > 0 )); then
    echo "::error::scope_secrets: absent requested key(s): ${missing[*]} (found $(( total - ${#missing[@]} )) of ${total} requested keys)"
    return 1
  fi
}
