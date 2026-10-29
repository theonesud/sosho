#!/usr/bin/env python3
"""
quick-plot.py: Zero-boilerplate chart generation using matplotlib/seaborn.
Saves plot to .pi/work/plots/<out_name>.png and prints concise status.
"""
import sys
import os
import argparse

def main():
    parser = argparse.ArgumentParser(description="Generate quick data plots")
    parser.add_argument("file", help="Input tabular file (.csv, .tsv, .parquet, .json)")
    parser.add_argument("--type", choices=['line', 'bar', 'scatter', 'hist', 'box', 'corr'], default='line')
    parser.add_argument("--x", help="X-axis column")
    parser.add_argument("--y", help="Y-axis column")
    parser.add_argument("--hue", help="Grouping/Hue column", default=None)
    parser.add_argument("--title", help="Plot title", default="")
    parser.add_argument("--out", help="Output filename in .pi/work/plots/", default="plot.png")

    args = parser.parse_args()

    plots_dir = os.getenv("SOSHO_PLOTS_DIR", ".pi/work/plots")
    os.makedirs(plots_dir, exist_ok=True)
    out_path = os.path.join(plots_dir, os.path.basename(args.out))

    import pandas as pd
    import matplotlib.pyplot as plt
    import seaborn as sns

    ext = os.path.splitext(args.file)[1].lower()
    if ext == '.csv':
        df = pd.read_csv(args.file)
    elif ext == '.tsv':
        df = pd.read_csv(args.file, sep='\t')
    elif ext == '.parquet':
        df = pd.read_parquet(args.file)
    elif ext == '.json':
        df = pd.read_json(args.file)
    else:
        df = pd.read_csv(args.file)

    plt.figure(figsize=(10, 6), dpi=120)
    sns.set_theme(style="whitegrid")

    if args.type == 'line':
        sns.lineplot(data=df, x=args.x, y=args.y, hue=args.hue)
    elif args.type == 'bar':
        sns.barplot(data=df, x=args.x, y=args.y, hue=args.hue)
    elif args.type == 'scatter':
        sns.scatterplot(data=df, x=args.x, y=args.y, hue=args.hue)
    elif args.type == 'hist':
        sns.histplot(data=df, x=args.x, hue=args.hue, kde=True)
    elif args.type == 'box':
        sns.boxplot(data=df, x=args.x, y=args.y, hue=args.hue)
    elif args.type == 'corr':
        num_df = df.select_dtypes(include=['number'])
        sns.heatmap(num_df.corr(), annot=True, fmt=".2f", cmap="coolwarm")

    plt.title(args.title or f"{args.type.title()} Plot: {args.x} vs {args.y}")
    plt.tight_layout()
    plt.savefig(out_path)
    plt.close()

    print(f"📊 Plot saved successfully: {out_path} ({os.path.getsize(out_path)} bytes)")

if __name__ == '__main__':
    main()
