#!/usr/bin/env bash
input=$(cat)

R=$'\033[0m'
DIM=$'\033[2m'
BOLD=$'\033[1m'
GREEN=$'\033[32m'
YELLOW=$'\033[33m'
RED=$'\033[31m'
CYAN=$'\033[36m'
MAGENTA=$'\033[35m'

color_pct() {
  local v=$1
  if [ -z "$v" ] || [ "$v" = "null" ]; then
    printf '%s-%s' "$DIM" "$R"
    return
  fi
  local i=${v%.*}
  local c=$GREEN
  [ "$i" -ge 50 ] && c=$YELLOW
  [ "$i" -ge 80 ] && c=$RED
  printf '%s%s%%%s' "$c" "$i" "$R"
}

bar() {
  local v=$1
  if [ -z "$v" ] || [ "$v" = "null" ]; then
    printf '%s----------%s' "$DIM" "$R"
    return
  fi
  local i=${v%.*}
  local filled=$((i / 10))
  [ "$filled" -gt 10 ] && filled=10
  local c=$GREEN
  [ "$i" -ge 50 ] && c=$YELLOW
  [ "$i" -ge 80 ] && c=$RED
  local out="" n=0
  while [ $n -lt 10 ]; do
    if [ $n -lt $filled ]; then out+="█"; else out+="░"; fi
    n=$((n + 1))
  done
  printf '%s%s%s' "$c" "$out" "$R"
}

fmt_ms() {
  local s=$((${1%.*} / 1000))
  local h=$((s / 3600)) m=$(((s % 3600) / 60)) sec=$((s % 60))
  if [ $h -gt 0 ]; then
    printf '%dh%02dm' $h $m
  elif [ $m -gt 0 ]; then
    printf '%dm%02ds' $m $sec
  else printf '%ds' $sec; fi
}

fmt_until() {
  local now
  now=$(date +%s)
  local d=$(($1 - now))
  [ $d -lt 0 ] && d=0
  printf '%dh%02dm' $((d / 3600)) $(((d % 3600) / 60))
}

model=$(jq -r '.model.display_name // .model.id // "unknown"' <<<"$input")
dir=$(jq -r '.workspace.current_dir // .cwd // ""' <<<"$input")
folder=$(basename "${dir:-.}")
branch=$(git -C "${dir:-.}" symbolic-ref --short -q HEAD 2>/dev/null)

ctx_pct=$(jq -r '.context_window.used_percentage // empty' <<<"$input")
ctx_size=$(jq -r '.context_window.context_window_size // empty' <<<"$input")
ctx_used=$(jq -r '(.context_window.current_usage // {}) | ((.input_tokens // 0) + (.cache_creation_input_tokens // 0) + (.cache_read_input_tokens // 0))' <<<"$input")

cost=$(jq -r '.cost.total_cost_usd // empty' <<<"$input")
dur=$(jq -r '.cost.total_duration_ms // empty' <<<"$input")
added=$(jq -r '.cost.total_lines_added // empty' <<<"$input")
removed=$(jq -r '.cost.total_lines_removed // empty' <<<"$input")

h5=$(jq -r '.rate_limits.five_hour.used_percentage // empty' <<<"$input")
h5r=$(jq -r '.rate_limits.five_hour.resets_at // empty' <<<"$input")
d7=$(jq -r '.rate_limits.seven_day.used_percentage // empty' <<<"$input")
d7r=$(jq -r '.rate_limits.seven_day.resets_at // empty' <<<"$input")

line1="${BOLD}${CYAN}${model}${R} ${DIM}|${R} ${MAGENTA}${folder}${R}"
[ -n "$branch" ] && line1+=" ${DIM}(${branch})${R}"
[ -n "$added$removed" ] && line1+=" ${GREEN}+${added:-0}${R} ${RED}-${removed:-0}${R}"

line2="${BOLD}ctx${R} $(bar "$ctx_pct") $(color_pct "$ctx_pct")"
if [ -n "$ctx_size" ]; then
  line2+=" ${DIM}(${ctx_used}/${ctx_size} tokens)${R}"
fi
if [ -n "$cost" ]; then
  line2+=" ${DIM}|${R} ${BOLD}cost${R} \$$(printf '%.2f' "$cost")"
fi
if [ -n "$dur" ]; then
  line2+=" ${DIM}|${R} ${BOLD}time${R} $(fmt_ms "$dur")"
fi

line3=""
if [ -n "$h5" ]; then
  line3="${BOLD}5h${R} $(bar "$h5") $(color_pct "$h5")"
  [ -n "$h5r" ] && line3+=" ${DIM}resets in $(fmt_until "$h5r")${R}"
fi
if [ -n "$d7" ]; then
  [ -n "$line3" ] && line3+=" ${DIM}|${R} "
  line3+="${BOLD}7d${R} $(bar "$d7") $(color_pct "$d7")"
  [ -n "$d7r" ] && line3+=" ${DIM}resets in $(fmt_until "$d7r")${R}"
fi

printf '%s\n' "$line1"
printf '%s\n' "$line2"
[ -n "$line3" ] && printf '%s\n' "$line3"
exit 0
