# Shared step shell for infisical.secrets.fetch's failure guard.
# Sourced from a composite's step as
#
#   . "${GITHUB_ACTION_PATH}/../claude.lib/fetch.sh"
#
# Infisical/secrets-action prints nothing on a non-zero exit — no ::error::,
# no HTTP status, no exit message (observed: run 30111303346, step `Secrets`
# red for 2.3s with zero log output). This makes that silent failure
# self-describing using only the non-secret input metadata already echoed in
# the fetch composite's own input group.

# report_fetch_failure <status> <identity> <project> <env> <path> <audience>
#
# Emits a plain "what was attempted" line (evidence before the failure),
# then a single ::error:: line carrying env=/path=/status=/identity=/
# audience= (matches the acceptance grep ::error::.*(env|path|status)),
# followed by prose classifying the two known causes — an auth/OIDC
# rejection or an Infisical service error — and the operator's next move for
# each. References only its own arguments: never the dotenv the fetch step
# would have written, so a fetched secret value can never reach this
# function or this log line.
report_fetch_failure() {
  local status="$1" identity="$2" project="$3" env="$4" path="$5" audience="$6"

  echo "Fetching Infisical secrets: identity=${identity} audience=${audience} project=${project} env=${env} path=${path}"
  echo "::error::Infisical secret fetch failed: status=${status} identity=${identity} audience=${audience} project=${project} env=${env} path=${path}. A non-zero exit here is either an auth/OIDC rejection (the identity lacks access, or audience/project/env/path don't match its trust policy) or an Infisical service error — the underlying step logs nothing on failure, so this is the known silent-failure mode. Operator guidance: rerun the failed job with identical inputs — going green indicates a transient blip and needs no action; a recurrence indicates a credentials/policy problem (rotate the identity or fix its access policy); a wrong path means fix the path."
}
