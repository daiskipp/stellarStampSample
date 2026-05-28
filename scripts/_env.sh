# Safe dotenv loader (sourced by other scripts).
#
# `source .env.*` is unsafe here: values like
#   VITE_NETWORK_PASSPHRASE=Standalone Network ; February 2017
# contain spaces and ';', which the shell would mis-parse / execute.
# load_env reads line-by-line and exports without evaluating.

load_env() {
  local file="$1"
  [ -f "$file" ] || { echo "ERROR: env file not found: $file" >&2; return 1; }
  local line key val
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in '' | \#*) continue ;; esac
    [ "${line#*=}" = "$line" ] && continue
    key="${line%%=*}"
    val="${line#*=}"
    # strip one layer of optional surrounding quotes
    case "$val" in
      \"*\") val="${val#\"}"; val="${val%\"}" ;;
      \'*\') val="${val#\'}"; val="${val%\'}" ;;
    esac
    export "$key=$val"
  done < "$file"
}
