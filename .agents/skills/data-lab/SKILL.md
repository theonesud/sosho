---
name: data-lab
description: Perform fast exploratory data analysis (EDA), generate data visualizations, and iteratively train small ML/DL models or run graph algorithms.
---

# Data Lab: Iterative Data Science, ML & Graph Algorithms

Focused primitives to inspect data and generate plots without polluting context with huge tables or matplotlib boilerplate.

## Usage

```bash
# 1. Quick Exploratory Data Analysis (<35 lines)
.agents/skills/data-lab/scripts/eda.py data.csv
.agents/skills/data-lab/scripts/eda.py database.sqlite users

# 2. Quick plotting (saved to $SOSHO_PERMANENT_DIR or --out path)
.agents/skills/data-lab/scripts/quick-plot.py data.csv --type scatter --x "age" --y "income" --out "scatter.png"
.agents/skills/data-lab/scripts/quick-plot.py data.csv --type corr --out "correlation.png"
.agents/skills/data-lab/scripts/quick-plot.py data.csv --type hist --x "latency" --out "dist.png"

# 3. Iterative ML & Graph experiments
# Save scripts to $SOSHO_PERMANENT_DIR, print only final metrics, and save plots/weights to disk
python3 "$SOSHO_PERMANENT_DIR/train_model.py"
```

## Protocol
1. Run `eda.py` first to inspect columns, types, and missing values.
2. For visual analysis, use `quick-plot.py`.
3. For graph algorithms (NetworkX) or PyTorch/scikit-learn models, execute via `$SOSHO_PERMANENT_DIR` scripts and report concise tabular metrics.
