export STAMPSHELL="${STAMPSHELL:-devcontainer}"

export STAMPSAMPLE_STATE_DIR="${STAMPSAMPLE_STATE_DIR:-$HOME/.stampsample-devcontainer}"
mkdir -p "$STAMPSAMPLE_STATE_DIR" "$STAMPSAMPLE_STATE_DIR/bash" 2>/dev/null || true

if [ -w "$STAMPSAMPLE_STATE_DIR/bash" ]; then
  export HISTFILE="$STAMPSAMPLE_STATE_DIR/bash/history"
else
  export HISTFILE="/tmp/stampsample-devcontainer-history-${USER:-vscode}"
fi
export HISTSIZE="${HISTSIZE:-50000}"
export HISTFILESIZE="${HISTFILESIZE:-100000}"
export HISTCONTROL="${HISTCONTROL:-ignoredups:erasedups}"
export HISTTIMEFORMAT="${HISTTIMEFORMAT:-%F %T }"

shopt -s histappend 2>/dev/null || true
PROMPT_COMMAND="history -a; history -n${PROMPT_COMMAND:+; $PROMPT_COMMAND}"

case "$-" in
  *i*)
    if [ -n "${BASH_VERSION:-}" ]; then
      export PS1="[devcontainer] ${PS1}"
    fi
    ;;
esac
