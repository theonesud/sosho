---
name: data-lab
description: Perform fast exploratory data analysis (EDA), generate data visualizations, and iteratively train small ML/DL models or run graph algorithms.
---

# Data Lab: Iterative Data Science, ML & Graph Algorithms

Focused primitives to inspect data and generate plots without polluting LLM context with thousands of table rows or boilerplate matplotlib scripts.

## Usage

```bash
# 1. Quick Exploratory Data Analysis (shape, columns, nulls, summary stats <35 lines)
.pi/skills/data-lab/scripts/eda.py data.csv
.pi/skills/data-lab/scripts/eda.py database.sqlite users

# 2. Quick plotting (saved to .pi/work/plots/<out>.png)
.pi/skills/data-lab/scripts/quick-plot.py data.csv --type scatter --x "age" --y "income" --out "scatter.png"
.pi/skills/data-lab/scripts/quick-plot.py data.csv --type corr --out "correlation.png"
.pi/skills/data-lab/scripts/quick-plot.py data.csv --type hist --x "latency" --out "dist.png"

# 3. Iterative ML & Graph experiments
# Write Python scripts in .pi/work/scratch/ (e.g. .pi/work/scratch/train_model.py).
# Have the script print ONLY final metrics and save weights/plots to .pi/work/plots/.
python3 .pi/work/scratch/train_model.py
```

## Protocol
1. Run `eda.py` first to inspect columns and distributions.
2. For insights or visual verification, run `quick-plot.py`.
3. For graph algorithms (NetworkX) or PyTorch/scikit-learn models, keep training scripts in `.pi/work/scratch/` and report only concise tabular metrics.
